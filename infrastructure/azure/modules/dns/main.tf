variable "resource_group_name" { type = string }
variable "environment"         { type = string }
variable "custom_domain"       { type = string }
variable "cdn_endpoint"        { type = string }
variable "api_fqdn"            { type = string }

resource "azurerm_dns_zone" "main" {
  count               = var.environment == "prod" ? 1 : 0
  name                = var.custom_domain
  resource_group_name = var.resource_group_name
}

# CNAME to Front Door endpoint
resource "azurerm_dns_cname_record" "app" {
  count               = var.environment == "prod" ? 1 : 0
  name                = "app"
  zone_name           = azurerm_dns_zone.main[0].name
  resource_group_name = var.resource_group_name
  ttl                 = 300
  record              = var.cdn_endpoint
}

resource "azurerm_dns_cname_record" "api" {
  count               = var.environment == "prod" ? 1 : 0
  name                = "api"
  zone_name           = azurerm_dns_zone.main[0].name
  resource_group_name = var.resource_group_name
  ttl                 = 60
  record              = var.cdn_endpoint
}

output "name_servers" {
  value = var.environment == "prod" ? azurerm_dns_zone.main[0].name_servers : []
}
