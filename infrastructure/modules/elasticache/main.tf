variable "environment"        { type = string }
variable "vpc_id"             { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "node_type"          { type = string }

resource "aws_elasticache_subnet_group" "main" {
  name       = "pulseway-${var.environment}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "redis" {
  name   = "pulseway-${var.environment}-redis"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
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

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "pulseway-${var.environment}"
  description                = "Pulseway Redis ${var.environment}"
  node_type                  = var.node_type
  num_cache_clusters         = var.environment == "prod" ? 3 : 1
  automatic_failover_enabled = var.environment == "prod"
  multi_az_enabled           = var.environment == "prod"

  engine_version         = "7.1"
  port                   = 6379
  parameter_group_name   = "default.redis7"

  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  snapshot_retention_limit = var.environment == "prod" ? 3 : 0
  snapshot_window          = "03:00-04:00"
}

output "primary_endpoint" { value = aws_elasticache_replication_group.main.primary_endpoint_address }
output "reader_endpoint"  { value = aws_elasticache_replication_group.main.reader_endpoint_address }
output "security_group_id"{ value = aws_security_group.redis.id }
