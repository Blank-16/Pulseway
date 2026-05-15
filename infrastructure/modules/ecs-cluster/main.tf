variable "environment" { type = string }
variable "vpc_id"      { type = string }

resource "aws_ecs_cluster" "main" {
  name = "pulseway-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

resource "aws_security_group" "ecs_tasks" {
  name   = "pulseway-${var.environment}-ecs-tasks"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

output "cluster_arn"        { value = aws_ecs_cluster.main.arn }
output "cluster_name"       { value = aws_ecs_cluster.main.name }
output "tasks_sg_id"        { value = aws_security_group.ecs_tasks.id }
