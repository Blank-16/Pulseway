variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "subnet_id"           { type = string }
variable "private_dns_zone_id" { type = string }
variable "keyvault_id"         { type = string }
variable "sku_name"            { type = string }
variable "tags"                { type = map(string) }

resource "random_password" "postgres" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "pulseway-${var.environment}-pg"
  resource_group_name    = var.resource_group_name
  location               = var.location
  version                = "16"
  administrator_login    = "pulseway_admin"
  administrator_password = random_password.postgres.result
  storage_mb             = var.environment == "prod" ? 131072 : 32768
  sku_name               = var.sku_name

  delegated_subnet_id    = var.subnet_id
  private_dns_zone_id    = var.private_dns_zone_id

  backup_retention_days        = var.environment == "prod" ? 35 : 7
  geo_redundant_backup_enabled = var.environment == "prod"

  high_availability {
    mode                      = var.environment == "prod" ? "ZoneRedundant" : "Disabled"
    standby_availability_zone = var.environment == "prod" ? "2" : null
  }

  maintenance_window {
    day_of_week  = 0
    start_hour   = 3
    start_minute = 0
  }

  tags = var.tags
}

resource "azurerm_postgresql_flexible_server_database" "pulseway" {
  name      = "pulseway"
  server_id = azurerm_postgresql_flexible_server.main.id
  collation = "en_US.utf8"
  charset   = "UTF8"
}

# Enable pgvector and pg_stat_statements extensions
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "PGCRYPTO,PG_STAT_STATEMENTS,PG_TRGM"
}

resource "azurerm_postgresql_flexible_server_configuration" "log_min_duration" {
  name      = "log_min_duration_statement"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "1000"
}

# Store connection string in Key Vault
resource "azurerm_key_vault_secret" "db_url" {
  name         = "database-url"
  value        = "postgresql://pulseway_admin:${random_password.postgres.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/pulseway?sslmode=require"
  key_vault_id = var.keyvault_id
}

output "fqdn"               { value = azurerm_postgresql_flexible_server.main.fqdn }
output "server_id"          { value = azurerm_postgresql_flexible_server.main.id }
output "db_url_secret_name" { value = azurerm_key_vault_secret.db_url.name }
