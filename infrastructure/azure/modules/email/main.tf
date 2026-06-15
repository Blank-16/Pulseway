variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "keyvault_id"         { type = string }
variable "tags"                { type = map(string) }

resource "azurerm_communication_service" "main" {
  name                = "pulseway-${var.environment}-acs"
  resource_group_name = var.resource_group_name
  data_location       = "United States"
  tags                = var.tags
}

resource "azurerm_email_communication_service" "main" {
  name                = "pulseway-${var.environment}-email"
  resource_group_name = var.resource_group_name
  data_location       = "United States"
  tags                = var.tags
}

resource "azurerm_email_communication_service_domain" "azure" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.main.id
  domain_management = "AzureManaged"
}

# Store ACS primary connection string in Key Vault for app consumption
resource "azurerm_key_vault_secret" "acs_conn_str" {
  name         = "azure-email-connection-str"
  value        = azurerm_communication_service.main.primary_connection_string
  key_vault_id = var.keyvault_id
}

output "connection_string_secret_name" { value = azurerm_key_vault_secret.acs_conn_str.name }
output "from_address"                  { value = "DoNotReply@${azurerm_email_communication_service_domain.azure.from_sender_domain}" }
