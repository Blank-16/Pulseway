variable "environment"     { type = string }
variable "check_queue_arn" { type = string }
variable "alert_queue_arn" { type = string }
variable "secrets_arns"    { type = list(string) }

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_role" "ecs_task_execution" {
  name = "pulseway-${var.environment}-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secrets_arns
    }]
  })
}

resource "aws_iam_role" "api_task" {
  name = "pulseway-${var.environment}-api-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role" "scheduler_task" {
  name = "pulseway-${var.environment}-scheduler-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "scheduler_sqs" {
  name = "sqs-send"
  role = aws_iam_role.scheduler_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage", "sqs:SendMessageBatch"]
      Resource = [var.check_queue_arn, var.alert_queue_arn]
    }]
  })
}

resource "aws_iam_role" "worker_task" {
  name = "pulseway-${var.environment}-worker-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "worker_sqs" {
  name = "sqs-consume"
  role = aws_iam_role.worker_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes", "sqs:SendMessage"]
      Resource = [var.check_queue_arn, var.alert_queue_arn]
    }]
  })
}

resource "aws_iam_role_policy" "worker_ses" {
  name = "ses-send"
  role = aws_iam_role.worker_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
    }]
  })
}

output "execution_role_arn"   { value = aws_iam_role.ecs_task_execution.arn }
output "api_task_role_arn"    { value = aws_iam_role.api_task.arn }
output "scheduler_task_role_arn" { value = aws_iam_role.scheduler_task.arn }
output "worker_task_role_arn" { value = aws_iam_role.worker_task.arn }
