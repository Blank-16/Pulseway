variable "environment"        { type = string }
variable "cluster_name"       { type = string }
variable "api_service_name"   { type = string }
variable "worker_service_name"{ type = string }
variable "check_queue_name"   { type = string }

resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.environment == "prod" ? 10 : 2
  min_capacity       = var.environment == "prod" ? 2 : 1
  resource_id        = "service/${var.cluster_name}/${var.api_service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "pulseway-${var.environment}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_target" "worker" {
  max_capacity       = var.environment == "prod" ? 20 : 3
  min_capacity       = var.environment == "prod" ? 2 : 1
  resource_id        = "service/${var.cluster_name}/${var.worker_service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Scale worker out aggressively on queue backlog — each task handles 10 concurrent checks
resource "aws_appautoscaling_policy" "worker_queue_depth" {
  name               = "pulseway-${var.environment}-worker-queue"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 500
      scaling_adjustment          = 1
    }
    step_adjustment {
      metric_interval_lower_bound = 500
      metric_interval_upper_bound = 2000
      scaling_adjustment          = 3
    }
    step_adjustment {
      metric_interval_lower_bound = 2000
      scaling_adjustment          = 5
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_scale_out" {
  alarm_name          = "pulseway-${var.environment}-worker-scale-out"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 30
  statistic           = "Maximum"
  threshold           = 100
  dimensions          = { QueueName = var.check_queue_name }
  alarm_actions       = [aws_appautoscaling_policy.worker_queue_depth.arn]
}

resource "aws_appautoscaling_policy" "worker_scale_in" {
  name               = "pulseway-${var.environment}-worker-scale-in"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_scale_in" {
  alarm_name          = "pulseway-${var.environment}-worker-scale-in"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 5
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 10
  dimensions          = { QueueName = var.check_queue_name }
  alarm_actions       = [aws_appautoscaling_policy.worker_scale_in.arn]
  treat_missing_data  = "notBreaching"
}
