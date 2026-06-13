variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "tenant_id"           { type = string }
variable "tags"                { type = map(string) }

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "main" {
  name                        = "pulseway-${var.environment}-kv"
  resource_group_name         = var.resource_group_name
  location                    = var.location
  tenant_id                   = var.tenant_id
  sku_name                    = "standard"
  soft_delete_retention_days  = var.environment == "prod" ? 90 : 7
  purge_protection_enabled    = var.environment == "prod"
  enable_rbac_authorization   = true
  tags                        = var.tags

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }
}

# CI/CD service principal gets full secret management
resource "azurerm_role_assignment" "terraform_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

output "keyvault_id"   { value = azurerm_key_vault.main.id }
output "keyvault_uri"  { value = azurerm_key_vault.main.vault_uri }
output "keyvault_name" { value = azurerm_key_vault.main.name }
