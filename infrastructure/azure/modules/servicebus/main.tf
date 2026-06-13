variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "tags"                { type = map(string) }

# Service Bus replaces AWS SQS as the message queue
resource "azurerm_servicebus_namespace" "main" {
  name                = "pulseway-${var.environment}-sb"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.environment == "prod" ? "Premium" : "Standard"
  capacity            = var.environment == "prod" ? 1 : 0
  tags                = var.tags

  # Premium namespace is zone-redundant and supports private endpoints
  zone_redundant = var.environment == "prod"
}

# Check jobs queue
resource "azurerm_servicebus_queue" "check_jobs" {
  name         = "check-jobs"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count              = 3
  lock_duration                   = "PT30S"
  default_message_time_to_live    = "P1D"
  dead_lettering_on_message_expiration = true
  max_size_in_megabytes           = 5120
  enable_partitioning             = var.environment == "prod"
}

# Alert jobs queue
resource "azurerm_servicebus_queue" "alert_jobs" {
  name         = "alert-jobs"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count              = 5
  lock_duration                   = "PT1M"
  default_message_time_to_live    = "P1D"
  dead_lettering_on_message_expiration = true
  max_size_in_megabytes           = 1024
}

# Dead-letter sub-queues are created automatically by Service Bus
# Access them via: check-jobs/$DeadLetterQueue

# Shared access policies for the scheduler (send) and worker (receive)
resource "azurerm_servicebus_queue_authorization_rule" "check_send" {
  name     = "scheduler-send"
  queue_id = azurerm_servicebus_queue.check_jobs.id
  send     = true
  listen   = false
  manage   = false
}

resource "azurerm_servicebus_queue_authorization_rule" "check_receive" {
  name     = "worker-receive"
  queue_id = azurerm_servicebus_queue.check_jobs.id
  send     = false
  listen   = true
  manage   = false
}

resource "azurerm_servicebus_queue_authorization_rule" "alert_send" {
  name     = "api-send"
  queue_id = azurerm_servicebus_queue.alert_jobs.id
  send     = true
  listen   = false
  manage   = false
}

resource "azurerm_servicebus_queue_authorization_rule" "alert_receive" {
  name     = "worker-receive"
  queue_id = azurerm_servicebus_queue.alert_jobs.id
  send     = false
  listen   = true
  manage   = false
}

output "namespace_name"                   { value = azurerm_servicebus_namespace.main.name }
output "namespace_id"                     { value = azurerm_servicebus_namespace.main.id }
output "check_queue_id"                   { value = azurerm_servicebus_queue.check_jobs.id }
output "alert_queue_id"                   { value = azurerm_servicebus_queue.alert_jobs.id }
output "check_queue_conn_str_secret_name" { value = "servicebus-check-conn-str" }
output "alert_queue_conn_str_secret_name" { value = "servicebus-alert-conn-str" }
# Connection strings — store in Key Vault in production rather than Terraform outputs
output "check_send_conn_str"   { value = azurerm_servicebus_queue_authorization_rule.check_send.primary_connection_string   sensitive = true }
output "check_receive_conn_str"{ value = azurerm_servicebus_queue_authorization_rule.check_receive.primary_connection_string sensitive = true }
output "alert_send_conn_str"   { value = azurerm_servicebus_queue_authorization_rule.alert_send.primary_connection_string   sensitive = true }
output "alert_receive_conn_str"{ value = azurerm_servicebus_queue_authorization_rule.alert_receive.primary_connection_string sensitive = true }
