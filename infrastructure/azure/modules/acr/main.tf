variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "tags"                { type = map(string) }

# Geo-replicated in prod; basic in staging
resource "azurerm_container_registry" "main" {
  name                = "pulseway${var.environment}acr"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.environment == "prod" ? "Premium" : "Basic"
  admin_enabled       = false
  tags                = var.tags

  dynamic "georeplications" {
    for_each = var.environment == "prod" ? ["westeurope", "southeastasia"] : []
    content {
      location                = georeplications.value
      zone_redundancy_enabled = true
    }
  }
}

# Managed identity for ACA to pull images — no stored credentials
resource "azurerm_user_assigned_identity" "acr_pull" {
  name                = "pulseway-${var.environment}-acr-pull"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.acr_pull.principal_id
}

output "login_server"      { value = azurerm_container_registry.main.login_server }
output "acr_id"            { value = azurerm_container_registry.main.id }
output "pull_identity_id"  { value = azurerm_user_assigned_identity.acr_pull.id }
output "pull_identity_client_id" { value = azurerm_user_assigned_identity.acr_pull.client_id }
