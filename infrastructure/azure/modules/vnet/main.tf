variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "address_space"       { type = string }
variable "tags"                { type = map(string) }

resource "azurerm_virtual_network" "main" {
  name                = "pulseway-${var.environment}-vnet"
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = [var.address_space]
  tags                = var.tags
}

# ACA requires /21 or larger subnet for internal load balancer
resource "azurerm_subnet" "aca" {
  name                 = "aca"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 2, 0)]
  delegation {
    name = "aca-delegation"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "db" {
  name                 = "db"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 4, 8)]
  service_endpoints    = ["Microsoft.Storage"]
  delegation {
    name = "postgres-delegation"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "cache" {
  name                 = "cache"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [cidrsubnet(var.address_space, 4, 9)]
}

resource "azurerm_private_dns_zone" "postgres" {
  name                = "pulseway-${var.environment}.private.postgres.database.azure.com"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "postgres-link"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
}

output "vnet_id"                      { value = azurerm_virtual_network.main.id }
output "aca_subnet_id"                { value = azurerm_subnet.aca.id }
output "db_subnet_id"                 { value = azurerm_subnet.db.id }
output "cache_subnet_id"              { value = azurerm_subnet.cache.id }
output "postgres_private_dns_zone_id" { value = azurerm_private_dns_zone.postgres.id }
