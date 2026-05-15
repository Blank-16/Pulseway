variable "environment"             { type = string }
variable "api_service_name"        { type = string }
variable "scheduler_service_name"  { type = string }
variable "worker_service_name"     { type = string }
variable "ecs_cluster_name"        { type = string }
variable "check_queue_name"        { type = string }
variable "alert_queue_name"        { type = string }
variable "alarm_sns_topic_arn"     { type = string }

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "pulseway-${var.environment}-api-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_actions       = [var.alarm_sns_topic_arn]
  ok_actions          = [var.alarm_sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "check_queue_depth" {
  alarm_name          = "pulseway-${var.environment}-check-queue-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1000
  dimensions          = { QueueName = var.check_queue_name }
  alarm_actions       = [var.alarm_sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "check_dlq_depth" {
  alarm_name          = "pulseway-${var.environment}-check-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  dimensions          = { QueueName = "${var.check_queue_name}-dlq" }
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/pulseway-${var.environment}-api"
  retention_in_days = var.environment == "prod" ? 90 : 14
}

resource "aws_cloudwatch_log_group" "scheduler" {
  name              = "/ecs/pulseway-${var.environment}-scheduler"
  retention_in_days = var.environment == "prod" ? 90 : 14
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/pulseway-${var.environment}-worker"
  retention_in_days = var.environment == "prod" ? 90 : 14
}

resource "aws_cloudwatch_metric_alarm" "api_p99_response_time" {
  alarm_name          = "pulseway-${var.environment}-api-p99-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 2 # 2 seconds p99 SLO breach
  alarm_actions       = [var.alarm_sns_topic_arn]
  ok_actions          = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu" {
  alarm_name          = "pulseway-${var.environment}-worker-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 85
  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.worker_service_name
  }
  alarm_actions = [var.alarm_sns_topic_arn]
}
