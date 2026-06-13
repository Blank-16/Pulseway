variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "subnet_id"           { type = string }
variable "keyvault_id"         { type = string }
variable "sku_name"            { type = string }
variable "tags"                { type = map(string) }

resource "azurerm_redis_cache" "main" {
  name                          = "pulseway-${var.environment}-redis"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  capacity                      = var.environment == "prod" ? 2 : 0
  family                        = var.environment == "prod" ? "P" : "C"
  sku_name                      = var.environment == "prod" ? "Premium" : "Basic"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false
  tags                          = var.tags

  redis_configuration {
    maxmemory_reserved              = var.environment == "prod" ? 250  : 10
    maxfragmentationmemory_reserved = var.environment == "prod" ? 250  : 10
    maxmemory_delta                 = var.environment == "prod" ? 250  : 10
    maxmemory_policy                = "allkeys-lru"
    # Enable AOF persistence in prod (Premium tier)
    aof_backup_enabled              = var.environment == "prod"
    aof_storage_connection_string_0 = var.environment == "prod" ? "" : null
  }

  # Inject into VNet for prod (Premium tier only)
  dynamic "patch_schedule" {
    for_each = [1]
    content {
      day_of_week    = "Sunday"
      start_hour_utc = 3
    }
  }
}

resource "azurerm_key_vault_secret" "redis_url" {
  name         = "redis-url"
  value        = "rediss://:${azurerm_redis_cache.main.primary_access_key}@${azurerm_redis_cache.main.hostname}:${azurerm_redis_cache.main.ssl_port}"
  key_vault_id = var.keyvault_id
}

output "hostname"             { value = azurerm_redis_cache.main.hostname }
output "ssl_port"             { value = azurerm_redis_cache.main.ssl_port }
output "redis_url_secret_name"{ value = azurerm_key_vault_secret.redis_url.name }
