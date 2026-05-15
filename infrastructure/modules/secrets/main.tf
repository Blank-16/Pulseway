variable "environment" { type = string }

locals {
  secret_names = ["database-url", "redis-url", "jwt-secret", "stripe-secret-key", "stripe-webhook-sig", "ses-smtp-password"]
}

resource "aws_secretsmanager_secret" "secrets" {
  for_each                = toset(local.secret_names)
  name                    = "pulseway/${var.environment}/${each.key}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 7
}

output "db_secret_arn"   { value = aws_secretsmanager_secret.secrets["database-url"].arn }
output "all_secret_arns" { value = [for s in aws_secretsmanager_secret.secrets : s.arn] }
