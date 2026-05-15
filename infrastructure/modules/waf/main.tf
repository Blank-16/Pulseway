variable "environment" { type = string }
variable "alb_arn"     { type = string }

resource "aws_wafv2_web_acl" "main" {
  name  = "pulseway-${var.environment}"
  scope = "REGIONAL"

  default_action { allow {} }

  rule {
    name     = "rate-limit-api"
    priority = 1

    action { block {} }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string = "/api/"
            field_to_match { uri_path {} }
            text_transformation { priority = 0; type = "NONE" }
            positional_constraint = "STARTS_WITH"
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitAPI"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-managed-common"
    priority = 2

    override_action { none {} }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedCommon"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 3

    override_action { none {} }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSKnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "PulsewayWAF"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

output "web_acl_arn" { value = aws_wafv2_web_acl.main.arn }
