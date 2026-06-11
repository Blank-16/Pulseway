terraform {
  required_version = ">= 1.10"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
  backend "azurerm" {
    resource_group_name  = "pulseway-tfstate"
    storage_account_name = "pulsewaytfstate"
    container_name       = "tfstate"
    key                  = "azure/terraform.tfstate"
    # OIDC auth — no storage account key stored anywhere.
    # The service principal created by bootstrap-azure.sh has Storage Blob Data Owner.
    use_azuread_auth     = true
    # Azure Blob Storage uses lease-based locking automatically when use_azuread_auth=true.
    # Concurrent applies are serialized; a stale lock expires after 60s automatically.
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy               = false
      recover_soft_deleted_key_vaults            = true
      purge_soft_deleted_secrets_on_destroy      = false
      recover_soft_deleted_secrets               = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = var.environment == "prod"
    }
  }
}

provider "azuread" {}

data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "main" {
  name     = "pulseway-${var.environment}"
  location = var.location
  tags     = local.common_tags
}

locals {
  common_tags = {
    Project     = "pulseway"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "vnet" {
  source              = "./modules/vnet"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  address_space       = var.vnet_address_space
  tags                = local.common_tags
}

module "acr" {
  source              = "./modules/acr"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  tags                = local.common_tags
}

module "keyvault" {
  source              = "./modules/keyvault"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  tenant_id           = data.azurerm_client_config.current.tenant_id
  tags                = local.common_tags
}

module "postgres" {
  source              = "./modules/postgres"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  subnet_id           = module.vnet.db_subnet_id
  private_dns_zone_id = module.vnet.postgres_private_dns_zone_id
  keyvault_id         = module.keyvault.keyvault_id
  sku_name            = var.postgres_sku
  tags                = local.common_tags
}

module "redis" {
  source              = "./modules/redis"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  subnet_id           = module.vnet.cache_subnet_id
  keyvault_id         = module.keyvault.keyvault_id
  sku_name            = var.redis_sku
  tags                = local.common_tags
}

module "servicebus" {
  source              = "./modules/servicebus"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  tags                = local.common_tags
}

module "aca" {
  source                       = "./modules/aca"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = var.location
  environment                  = var.environment
  infrastructure_subnet_id     = module.vnet.aca_subnet_id
  acr_login_server             = module.acr.login_server
  acr_id                       = module.acr.acr_id
  keyvault_id                  = module.keyvault.keyvault_id
  keyvault_uri                 = module.keyvault.keyvault_uri
  image_tag                    = var.image_tag
  check_queue_conn_str_secret  = module.servicebus.check_queue_conn_str_secret_name
  alert_queue_conn_str_secret  = module.servicebus.alert_queue_conn_str_secret_name
  db_url_secret                = module.postgres.db_url_secret_name
  redis_url_secret             = module.redis.redis_url_secret_name
  tags                         = local.common_tags
}

module "cdn" {
  source              = "./modules/cdn"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  api_fqdn            = module.aca.api_fqdn
  web_fqdn            = module.aca.web_fqdn
  custom_domain       = var.custom_domain
  tags                = local.common_tags
}

module "monitoring" {
  source              = "./modules/monitoring"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  aca_env_id          = module.aca.environment_id
  alert_email         = var.alert_email
  tags                = local.common_tags
}

module "email" {
  source              = "./modules/email"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  environment         = var.environment
  keyvault_id         = module.keyvault.keyvault_id
  tags                = local.common_tags
}

module "dns" {
  source              = "./modules/dns"
  resource_group_name = azurerm_resource_group.main.name
  environment         = var.environment
  custom_domain       = var.custom_domain
  cdn_endpoint        = module.cdn.endpoint_hostname
  api_fqdn            = module.aca.api_fqdn
}
