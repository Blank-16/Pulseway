variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (staging | prod)"
  type        = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod"
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.small"
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for ALB HTTPS listener"
  type        = string
}

variable "cloudfront_certificate_arn" {
  description = "ACM certificate ARN for CloudFront (must be us-east-1)"
  type        = string
}

variable "email_domain" {
  description = "Domain for SES sending"
  type        = string
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms"
  type        = string
}

variable "image_tag" {
  description = "Docker image tag to deploy (Git SHA)"
  type        = string
  default     = "latest"
}
