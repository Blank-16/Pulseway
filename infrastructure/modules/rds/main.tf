variable "environment"        { type = string }
variable "vpc_id"             { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "db_secret_arn"      { type = string }
variable "instance_class"     { type = string }

resource "aws_db_subnet_group" "main" {
  name       = "pulseway-${var.environment}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "rds" {
  name   = "pulseway-${var.environment}-rds"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_rds_cluster" "main" {
  cluster_identifier      = "pulseway-${var.environment}"
  engine                  = "aurora-postgresql"
  engine_version          = "16.6"
  engine_mode             = "provisioned"
  database_name           = "pulseway"
  master_username         = "pulseway"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period      = var.environment == "prod" ? 14 : 3
  preferred_backup_window      = "02:00-03:00"
  preferred_maintenance_window = "sun:04:00-sun:05:00"

  deletion_protection             = var.environment == "prod"
  skip_final_snapshot             = var.environment != "prod"
  final_snapshot_identifier       = var.environment == "prod" ? "pulseway-prod-final" : null
  storage_encrypted               = true
  enabled_cloudwatch_logs_exports = ["postgresql"]

  serverlessv2_scaling_configuration {
    min_capacity = var.environment == "prod" ? 2 : 0.5
    max_capacity = var.environment == "prod" ? 32 : 4
  }
}

resource "aws_rds_cluster_instance" "main" {
  count              = var.environment == "prod" ? 2 : 1
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version
}

output "cluster_endpoint"       { value = aws_rds_cluster.main.endpoint }
output "reader_endpoint"        { value = aws_rds_cluster.main.reader_endpoint }
output "security_group_id"      { value = aws_security_group.rds.id }
