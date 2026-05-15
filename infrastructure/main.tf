terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.96"
    }
  }
  backend "s3" {
    bucket         = "pulseway-tfstate"
    key            = "infra/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "pulseway-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "pulseway"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

module "vpc" {
  source      = "../modules/vpc"
  environment = var.environment
  cidr_block  = var.vpc_cidr
}

module "secrets" {
  source      = "../modules/secrets"
  environment = var.environment
}

module "rds" {
  source             = "../modules/rds"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  db_secret_arn      = module.secrets.db_secret_arn
  instance_class     = var.rds_instance_class
}

module "elasticache" {
  source             = "../modules/elasticache"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type
}

module "sqs" {
  source      = "../modules/sqs"
  environment = var.environment
}

module "iam" {
  source           = "../modules/iam"
  environment      = var.environment
  check_queue_arn  = module.sqs.check_queue_arn
  alert_queue_arn  = module.sqs.alert_queue_arn
  secrets_arns     = module.secrets.all_secret_arns
}

module "ecs_cluster" {
  source      = "../modules/ecs-cluster"
  environment = var.environment
  vpc_id      = module.vpc.vpc_id
}

module "alb" {
  source            = "../modules/alb"
  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = var.acm_certificate_arn
}

module "waf" {
  source      = "../modules/waf"
  environment = var.environment
  alb_arn     = module.alb.alb_arn
}

module "s3" {
  source      = "../modules/s3"
  environment = var.environment
}

module "cloudfront" {
  source          = "../modules/cloudfront"
  environment     = var.environment
  s3_bucket_id    = module.s3.assets_bucket_id
  s3_bucket_domain = module.s3.assets_bucket_domain
  certificate_arn = var.cloudfront_certificate_arn
}

module "ses" {
  source      = "../modules/ses"
  environment = var.environment
  domain      = var.email_domain
}

module "ecs_services" {
  source      = "../modules/ecs-services"
  environment = var.environment

  cluster_arn  = module.ecs_cluster.cluster_arn
  cluster_name = module.ecs_cluster.cluster_name
  vpc_id       = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  tasks_sg_id  = module.ecs_cluster.tasks_sg_id
  alb_sg_id    = module.alb.alb_sg_id

  execution_role_arn      = module.iam.execution_role_arn
  api_task_role_arn       = module.iam.api_task_role_arn
  scheduler_task_role_arn = module.iam.scheduler_task_role_arn
  worker_task_role_arn    = module.iam.worker_task_role_arn

  api_tg_arn        = module.alb.api_tg_arn
  ecr_registry      = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
  image_tag         = var.image_tag
  check_queue_url   = module.sqs.check_queue_url
  alert_queue_url   = module.sqs.alert_queue_url

  log_group_api       = "/ecs/pulseway-${var.environment}-api"
  log_group_scheduler = "/ecs/pulseway-${var.environment}-scheduler"
  log_group_worker    = "/ecs/pulseway-${var.environment}-worker"
}

data "aws_caller_identity" "current" {}

module "autoscaling" {
  source      = "../modules/autoscaling"
  environment = var.environment

  cluster_name        = module.ecs_cluster.cluster_name
  api_service_name    = module.ecs_services.api_service_name
  worker_service_name = module.ecs_services.worker_service_name
  check_queue_name    = module.sqs.check_queue_name
}

module "cloudwatch" {
  source                    = "../modules/cloudwatch"
  environment               = var.environment
  api_service_name          = module.ecs_services.api_service_name
  scheduler_service_name    = module.ecs_services.scheduler_service_name
  worker_service_name       = module.ecs_services.worker_service_name
  ecs_cluster_name          = module.ecs_cluster.cluster_name
  check_queue_name          = module.sqs.check_queue_name
  alert_queue_name          = module.sqs.alert_queue_name
  alarm_sns_topic_arn       = var.alarm_sns_topic_arn
}
