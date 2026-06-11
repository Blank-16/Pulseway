variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "Must be staging or prod"
  }
}

variable "location" {
  type    = string
  default = "eastus"
}

variable "vnet_address_space" {
  type    = string
  default = "10.1.0.0/16"
}

variable "postgres_sku" {
  type    = string
  default = "B_Standard_B2ms"
  # Prod: GP_Standard_D4s_v3
}

variable "redis_sku" {
  type    = string
  default = "Basic"
  # Prod: Premium (enables persistence, geo-replication, private endpoint)
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "custom_domain" {
  type        = string
  description = "e.g. pulseway.dev"
}

variable "alert_email" {
  type        = string
  description = "Email address for Azure Monitor alert notifications"
}
