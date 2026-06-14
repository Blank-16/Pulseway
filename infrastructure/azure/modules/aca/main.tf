variable "resource_group_name"         { type = string }
variable "location"                    { type = string }
variable "environment"                 { type = string }
variable "infrastructure_subnet_id"    { type = string }
variable "acr_login_server"            { type = string }
variable "acr_id"                      { type = string }
variable "keyvault_id"                 { type = string }
variable "keyvault_uri"                { type = string }
variable "image_tag"                   { type = string }
variable "check_queue_conn_str_secret" { type = string }
variable "alert_queue_conn_str_secret" { type = string }
variable "db_url_secret"               { type = string }
variable "redis_url_secret"            { type = string }
variable "tags"                        { type = map(string) }

# Managed identity for the ACA environment (used by all apps for Key Vault access)
resource "azurerm_user_assigned_identity" "aca" {
  name                = "pulseway-${var.environment}-aca"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

resource "azurerm_role_assignment" "aca_keyvault" {
  scope                = var.keyvault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.aca.principal_id
}

resource "azurerm_role_assignment" "aca_acr" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.aca.principal_id
}

# Log Analytics workspace for ACA container logs
resource "azurerm_log_analytics_workspace" "main" {
  name                = "pulseway-${var.environment}-logs"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = var.environment == "prod" ? 90 : 30
  tags                = var.tags
}

# Container Apps Environment — internal VNet injection
resource "azurerm_container_app_environment" "main" {
  name                           = "pulseway-${var.environment}-env"
  resource_group_name            = var.resource_group_name
  location                       = var.location
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id       = var.infrastructure_subnet_id
  internal_load_balancer_enabled = false
  zone_redundancy_enabled        = var.environment == "prod"
  tags                           = var.tags
}

locals {
  common_secrets = [
    {
      name                = "database-url"
      key_vault_secret_id = "${var.keyvault_uri}secrets/${var.db_url_secret}"
      identity            = azurerm_user_assigned_identity.aca.id
    },
    {
      name                = "redis-url"
      key_vault_secret_id = "${var.keyvault_uri}secrets/${var.redis_url_secret}"
      identity            = azurerm_user_assigned_identity.aca.id
    },
    {
      name                = "check-queue-conn"
      key_vault_secret_id = "${var.keyvault_uri}secrets/${var.check_queue_conn_str_secret}"
      identity            = azurerm_user_assigned_identity.aca.id
    },
    {
      name                = "alert-queue-conn"
      key_vault_secret_id = "${var.keyvault_uri}secrets/${var.alert_queue_conn_str_secret}"
      identity            = azurerm_user_assigned_identity.aca.id
    },
  ]
  common_env = [
    { name = "NODE_ENV",    value = "production" },
    { name = "CLOUD",       value = "azure" },
  ]
}

# API Container App
resource "azurerm_container_app" "api" {
  name                         = "pulseway-${var.environment}-api"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.aca.id]
  }

  registry {
    server   = var.acr_login_server
    identity = azurerm_user_assigned_identity.aca.id
  }

  dynamic "secret" {
    for_each = local.common_secrets
    content {
      name                = secret.value.name
      key_vault_secret_id = secret.value.key_vault_secret_id
      identity            = secret.value.identity
    }
  }

  template {
    min_replicas = var.environment == "prod" ? 2 : 1
    max_replicas = var.environment == "prod" ? 10 : 3

    http_scale_rule {
      name                = "http-scaling"
      concurrent_requests = "50"
    }

    container {
      name   = "api"
      image  = "${var.acr_login_server}/pulseway-api:${var.image_tag}"
      cpu    = var.environment == "prod" ? 1.0 : 0.5
      memory = var.environment == "prod" ? "2Gi" : "1Gi"

      dynamic "env" {
        for_each = local.common_env
        content { name = env.value.name; value = env.value.value }
      }

      env { name = "DATABASE_URL"; secret_name = "database-url" }
      env { name = "REDIS_URL";    secret_name = "redis-url" }
      env { name = "AZURE_SERVICEBUS_CHECK_CONN_STR"; secret_name = "check-queue-conn" }
      env { name = "AZURE_SERVICEBUS_ALERT_CONN_STR"; secret_name = "alert-queue-conn" }
      env { name = "AZURE_KEYVAULT_URI"; value = var.keyvault_uri }

      liveness_probe {
        transport        = "HTTP"
        path             = "/health/live"
        port             = 4000
        initial_delay    = 10
        interval_seconds = 15
        timeout          = 5
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        path      = "/health/ready"
        port      = 4000
        interval_seconds = 10
        timeout          = 5
        failure_count_threshold = 3
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 4000
    transport        = "http2"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
}

# Scheduler Container App — single replica, no ingress
resource "azurerm_container_app" "scheduler" {
  name                         = "pulseway-${var.environment}-scheduler"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.aca.id]
  }

  registry {
    server   = var.acr_login_server
    identity = azurerm_user_assigned_identity.aca.id
  }

  dynamic "secret" {
    for_each = local.common_secrets
    content {
      name                = secret.value.name
      key_vault_secret_id = secret.value.key_vault_secret_id
      identity            = secret.value.identity
    }
  }

  template {
    # Scheduler must be a single instance — multiple would cause duplicate check enqueues
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "scheduler"
      image  = "${var.acr_login_server}/pulseway-scheduler:${var.image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      dynamic "env" {
        for_each = local.common_env
        content { name = env.value.name; value = env.value.value }
      }

      env { name = "DATABASE_URL"; secret_name = "database-url" }
      env { name = "REDIS_URL";    secret_name = "redis-url" }
      env { name = "AZURE_SERVICEBUS_CHECK_CONN_STR"; secret_name = "check-queue-conn" }
    }
  }
}

# Worker Container App — scales on Service Bus queue depth
resource "azurerm_container_app" "worker" {
  name                         = "pulseway-${var.environment}-worker"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.aca.id]
  }

  registry {
    server   = var.acr_login_server
    identity = azurerm_user_assigned_identity.aca.id
  }

  dynamic "secret" {
    for_each = local.common_secrets
    content {
      name                = secret.value.name
      key_vault_secret_id = secret.value.key_vault_secret_id
      identity            = secret.value.identity
    }
  }

  template {
    min_replicas = var.environment == "prod" ? 2 : 1
    max_replicas = var.environment == "prod" ? 20 : 5

    # KEDA: scale on Azure Service Bus queue depth
    azure_queue_scale_rule {
      name         = "sb-queue-depth"
      queue_name   = "check-jobs"
      queue_length = 100
      authentication {
        secret_name       = "check-queue-conn"
        trigger_parameter = "connection"
      }
    }

    container {
      name   = "worker"
      image  = "${var.acr_login_server}/pulseway-worker:${var.image_tag}"
      cpu    = var.environment == "prod" ? 1.0 : 0.5
      memory = var.environment == "prod" ? "2Gi" : "1Gi"

      dynamic "env" {
        for_each = local.common_env
        content { name = env.value.name; value = env.value.value }
      }

      env { name = "DATABASE_URL"; secret_name = "database-url" }
      env { name = "REDIS_URL";    secret_name = "redis-url" }
      env { name = "AZURE_SERVICEBUS_CHECK_CONN_STR"; secret_name = "check-queue-conn" }
      env { name = "AZURE_SERVICEBUS_ALERT_CONN_STR"; secret_name = "alert-queue-conn" }
      env { name = "WORKER_MAX_CONCURRENCY"; value = var.environment == "prod" ? "20" : "10" }
    }
  }
}

# Web frontend Container App
resource "azurerm_container_app" "web" {
  name                         = "pulseway-${var.environment}-web"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.aca.id]
  }

  registry {
    server   = var.acr_login_server
    identity = azurerm_user_assigned_identity.aca.id
  }

  template {
    min_replicas = var.environment == "prod" ? 2 : 1
    max_replicas = var.environment == "prod" ? 5 : 2

    http_scale_rule {
      name                = "http-scaling"
      concurrent_requests = "100"
    }

    container {
      name   = "web"
      image  = "${var.acr_login_server}/pulseway-web:${var.image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = "https://api.${var.environment == "prod" ? "" : "${var.environment}."}pulseway.dev"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
}

output "environment_id" { value = azurerm_container_app_environment.main.id }
output "api_fqdn"       { value = azurerm_container_app.api.latest_revision_fqdn }
output "web_fqdn"       { value = azurerm_container_app.web.latest_revision_fqdn }
output "worker_name"    { value = azurerm_container_app.worker.name }
output "scheduler_name" { value = azurerm_container_app.scheduler.name }
