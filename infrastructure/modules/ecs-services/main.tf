variable "environment"          { type = string }
variable "cluster_arn"          { type = string }
variable "cluster_name"         { type = string }
variable "vpc_id"               { type = string }
variable "private_subnet_ids"   { type = list(string) }
variable "tasks_sg_id"          { type = string }
variable "execution_role_arn"   { type = string }
variable "api_task_role_arn"    { type = string }
variable "scheduler_task_role_arn" { type = string }
variable "worker_task_role_arn" { type = string }
variable "api_tg_arn"           { type = string }
variable "alb_sg_id"            { type = string }
variable "ecr_registry"         { type = string }
variable "image_tag"            { type = string }
variable "check_queue_url"      { type = string }
variable "alert_queue_url"      { type = string }
variable "log_group_api"        { type = string }
variable "log_group_scheduler"  { type = string }
variable "log_group_worker"     { type = string }

data "aws_region" "current" {}

locals {
  common_env = [
    { name = "NODE_ENV",    value = "production" },
    { name = "AWS_REGION",  value = data.aws_region.current.name },
    { name = "CHECK_JOBS_QUEUE_URL", value = var.check_queue_url },
    { name = "ALERT_JOBS_QUEUE_URL", value = var.alert_queue_url },
  ]
}

resource "aws_security_group" "api" {
  name   = "pulseway-${var.environment}-api"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [var.alb_sg_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "pulseway-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.environment == "prod" ? "1024" : "512"
  memory                   = var.environment == "prod" ? "2048" : "1024"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.api_task_role_arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = "${var.ecr_registry}/pulseway-api:${var.image_tag}"
    essential = true
    portMappings = [{ containerPort = 4000, protocol = "tcp" }]

    environment = local.common_env

    secrets = [
      { name = "DATABASE_URL",          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/database-url" },
      { name = "REDIS_URL",             valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/redis-url" },
      { name = "JWT_SECRET",            valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/jwt-secret" },
      { name = "STRIPE_SECRET_KEY",     valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/stripe-secret-key" },
      { name = "STRIPE_WEBHOOK_SECRET", valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/stripe-webhook-sig" },
      { name = "SES_FROM_ADDRESS",      valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/ses-from-address" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options   = {
        "awslogs-group"         = var.log_group_api
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "api"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:4000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }

    ulimits = [{ name = "nofile", softLimit = 65536, hardLimit = 65536 }]
  }])

  lifecycle { create_before_destroy = true }
}

resource "aws_ecs_service" "api" {
  name                               = "pulseway-${var.environment}-api"
  cluster                            = var.cluster_arn
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.environment == "prod" ? 2 : 1
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 30

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller { type = "ECS" }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.api_tg_arn
    container_name   = "api"
    container_port   = 4000
  }

  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_task_definition" "scheduler" {
  family                   = "pulseway-${var.environment}-scheduler"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.scheduler_task_role_arn

  container_definitions = jsonencode([{
    name      = "scheduler"
    image     = "${var.ecr_registry}/pulseway-scheduler:${var.image_tag}"
    essential = true

    environment = local.common_env

    secrets = [
      { name = "DATABASE_URL", valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/database-url" },
      { name = "REDIS_URL",    valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/redis-url" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options   = {
        "awslogs-group"         = var.log_group_scheduler
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "scheduler"
      }
    }
  }])

  lifecycle { create_before_destroy = true }
}

resource "aws_ecs_service" "scheduler" {
  name            = "pulseway-${var.environment}-scheduler"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.scheduler.arn
  # Single scheduler instance — scale-out would cause duplicate enqueues
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_circuit_breaker { enable = true; rollback = true }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.tasks_sg_id]
    assign_public_ip = false
  }

  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "pulseway-${var.environment}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.environment == "prod" ? "1024" : "512"
  memory                   = var.environment == "prod" ? "2048" : "1024"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.worker_task_role_arn

  container_definitions = jsonencode([{
    name      = "worker"
    image     = "${var.ecr_registry}/pulseway-worker:${var.image_tag}"
    essential = true

    environment = concat(local.common_env, [
      { name = "WORKER_MAX_CONCURRENCY", value = var.environment == "prod" ? "20" : "10" },
    ])

    secrets = [
      { name = "DATABASE_URL", valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/database-url" },
      { name = "REDIS_URL",    valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:pulseway/${var.environment}/redis-url" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options   = {
        "awslogs-group"         = var.log_group_worker
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "worker"
      }
    }

    ulimits = [{ name = "nofile", softLimit = 65536, hardLimit = 65536 }]
  }])

  lifecycle { create_before_destroy = true }
}

resource "aws_ecs_service" "worker" {
  name            = "pulseway-${var.environment}-worker"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.environment == "prod" ? 3 : 1
  launch_type     = "FARGATE"

  deployment_circuit_breaker { enable = true; rollback = true }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.tasks_sg_id]
    assign_public_ip = false
  }

  lifecycle { ignore_changes = [task_definition] }
}

output "api_service_name"       { value = aws_ecs_service.api.name }
output "scheduler_service_name" { value = aws_ecs_service.scheduler.name }
output "worker_service_name"    { value = aws_ecs_service.worker.name }
output "api_sg_id"              { value = aws_security_group.api.id }
