variable "resource_group_name" { type = string }
variable "location"            { type = string }
variable "environment"         { type = string }
variable "api_fqdn"            { type = string }
variable "web_fqdn"            { type = string }
variable "custom_domain"       { type = string }
variable "tags"                { type = map(string) }

# Azure Front Door Standard — global CDN + WAF + TLS termination
resource "azurerm_cdn_frontdoor_profile" "main" {
  name                = "pulseway-${var.environment}-afd"
  resource_group_name = var.resource_group_name
  sku_name            = var.environment == "prod" ? "Premium_AzureFrontDoor" : "Standard_AzureFrontDoor"
  tags                = var.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "main" {
  name                     = "pulseway-${var.environment}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  tags                     = var.tags
}

# Origin groups
resource "azurerm_cdn_frontdoor_origin_group" "api" {
  name                     = "api-origins"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
    additional_latency_in_milliseconds = 50
  }

  health_probe {
    path                = "/health/ready"
    request_type        = "GET"
    protocol            = "Https"
    interval_in_seconds = 15
  }
}

resource "azurerm_cdn_frontdoor_origin" "api" {
  name                          = "api-aca"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.api.id
  enabled                       = true
  host_name                     = var.api_fqdn
  origin_host_header            = var.api_fqdn
  http_port                     = 80
  https_port                    = 443
  certificate_name_check_enabled = true
  priority                       = 1
  weight                         = 1000
}

resource "azurerm_cdn_frontdoor_origin_group" "web" {
  name                     = "web-origins"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }

  health_probe {
    path                = "/"
    request_type        = "HEAD"
    protocol            = "Https"
    interval_in_seconds = 30
  }
}

resource "azurerm_cdn_frontdoor_origin" "web" {
  name                          = "web-aca"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.web.id
  enabled                       = true
  host_name                     = var.web_fqdn
  origin_host_header            = var.web_fqdn
  https_port                    = 443
  http_port                     = 80
  certificate_name_check_enabled = true
  priority                       = 1
  weight                         = 1000
}

# Routes — /api/* to API, everything else to web
resource "azurerm_cdn_frontdoor_route" "api" {
  name                          = "api-route"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.main.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.api.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.api.id]
  enabled                       = true
  forwarding_protocol           = "HttpsOnly"
  https_redirect_enabled        = true
  patterns_to_match             = ["/api/*", "/health/*", "/metrics"]
  supported_protocols           = ["Http", "Https"]
  link_to_default_domain        = true
  cache {
    query_string_caching_behavior = "IgnoreQueryString"
  }
}

resource "azurerm_cdn_frontdoor_route" "web" {
  name                          = "web-route"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.main.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.web.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.web.id]
  enabled                       = true
  forwarding_protocol           = "HttpsOnly"
  https_redirect_enabled        = true
  patterns_to_match             = ["/*"]
  supported_protocols           = ["Http", "Https"]
  link_to_default_domain        = true
  cache {
    query_string_caching_behavior = "UseQueryString"
    compression_enabled           = true
    content_types_to_compress     = ["text/html", "text/css", "application/javascript", "application/json"]
  }
}

# WAF policy (Premium SKU only — falls back to standard rules in Standard)
resource "azurerm_cdn_frontdoor_firewall_policy" "main" {
  count               = var.environment == "prod" ? 1 : 0
  name                = "pulseway${var.environment}waf"
  resource_group_name = var.resource_group_name
  sku_name            = azurerm_cdn_frontdoor_profile.main.sku_name
  enabled             = true
  mode                = "Prevention"
  tags                = var.tags

  managed_rule {
    type    = "Microsoft_DefaultRuleSet"
    version = "2.1"
    action  = "Block"
  }

  managed_rule {
    type    = "Microsoft_BotManagerRuleSet"
    version = "1.0"
    action  = "Block"
  }

  custom_block_response_status_code = 429
}

resource "azurerm_cdn_frontdoor_security_policy" "main" {
  count                    = var.environment == "prod" ? 1 : 0
  name                     = "pulseway-${var.environment}-security"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id

  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.main[0].id
      association {
        domain {
          cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.main.id
        }
        patterns_to_match = ["/*"]
      }
    }
  }
}

output "endpoint_hostname" { value = azurerm_cdn_frontdoor_endpoint.main.host_name }
output "profile_id"        { value = azurerm_cdn_frontdoor_profile.main.id }
