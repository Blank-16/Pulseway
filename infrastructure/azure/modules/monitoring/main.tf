variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "aca_env_id"          { type = string }
variable "alert_email"         { type = string }
variable "tags"                { type = map(string) }

resource "azurerm_application_insights" "main" {
  name                = "pulseway-${var.environment}-appinsights"
  resource_group_name = var.resource_group_name
  location            = var.location
  application_type    = "Node.JS"
  retention_in_days   = var.environment == "prod" ? 90 : 30
  tags                = var.tags
}

resource "azurerm_monitor_action_group" "alerts" {
  name                = "pulseway-${var.environment}-alerts"
  resource_group_name = var.resource_group_name
  short_name          = "pw-alert"
  tags                = var.tags

  email_receiver {
    name                    = "ops-email"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }
}

# API 5xx error rate alert
resource "azurerm_monitor_metric_alert" "api_5xx" {
  name                = "pulseway-${var.environment}-api-5xx"
  resource_group_name = var.resource_group_name
  scopes              = [var.aca_env_id]
  description         = "API 5xx error rate elevated"
  severity            = 1
  frequency           = "PT1M"
  window_size         = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "microsoft.app/containerapps"
    metric_name      = "Requests"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 50

    dimension {
      name     = "statusCodeCategory"
      operator = "Include"
      values   = ["5xx"]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }
}

# API p99 response time
resource "azurerm_monitor_metric_alert" "api_latency" {
  name                = "pulseway-${var.environment}-api-latency"
  resource_group_name = var.resource_group_name
  scopes              = [var.aca_env_id]
  description         = "API p99 response time > 2s"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT10M"
  tags                = var.tags

  criteria {
    metric_namespace = "microsoft.app/containerapps"
    metric_name      = "RespondTime"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 2000
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }
}

# Worker replica count drops to 0 (crash loop or scale-in misconfiguration)
resource "azurerm_monitor_metric_alert" "worker_down" {
  name                = "pulseway-${var.environment}-worker-down"
  resource_group_name = var.resource_group_name
  scopes              = [var.aca_env_id]
  description         = "Worker Container App has 0 replicas"
  severity            = 0
  frequency           = "PT1M"
  window_size         = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "microsoft.app/containerapps"
    metric_name      = "RunningReplicas"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1

    dimension {
      name     = "revisionName"
      operator = "Include"
      values   = ["*worker*"]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }
}

output "app_insights_connection_string"    { value = azurerm_application_insights.main.connection_string  sensitive = true }
output "app_insights_instrumentation_key"  { value = azurerm_application_insights.main.instrumentation_key sensitive = true }
output "action_group_id"                   { value = azurerm_monitor_action_group.alerts.id }
