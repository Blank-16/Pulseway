variable "environment" { type = string }

resource "aws_sqs_queue" "check_jobs_dlq" {
  name                      = "pulseway-${var.environment}-check-jobs-dlq"
  message_retention_seconds = 1_209_600 # 14 days
}

resource "aws_sqs_queue" "alert_jobs_dlq" {
  name                      = "pulseway-${var.environment}-alert-jobs-dlq"
  message_retention_seconds = 1_209_600
}

resource "aws_sqs_queue" "check_jobs" {
  name                       = "pulseway-${var.environment}-check-jobs.fifo"
  fifo_queue                 = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 30

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.check_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "alert_jobs" {
  name                       = "pulseway-${var.environment}-alert-jobs.fifo"
  fifo_queue                 = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.alert_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

output "check_queue_url"  { value = aws_sqs_queue.check_jobs.url }
output "check_queue_arn"  { value = aws_sqs_queue.check_jobs.arn }
output "check_queue_name" { value = aws_sqs_queue.check_jobs.name }
output "alert_queue_url"  { value = aws_sqs_queue.alert_jobs.url }
output "alert_queue_arn"  { value = aws_sqs_queue.alert_jobs.arn }
output "alert_queue_name" { value = aws_sqs_queue.alert_jobs.name }
