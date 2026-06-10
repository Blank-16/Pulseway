#!/usr/bin/env bash
# Bootstrap Azure Terraform state backend.
# Run ONCE before the first `terraform init`.
# Requires: az CLI logged in, Contributor role on target subscription.

set -euo pipefail

ENVIRONMENT=${1:-staging}
SUBSCRIPTION=$(az account show --query id -o tsv)
LOCATION=${2:-eastus}
RG="pulseway-tfstate"
STORAGE_ACCOUNT="pulsewaytfstate"
CONTAINER="tfstate"

echo "Bootstrapping Terraform state backend for subscription: $SUBSCRIPTION"
echo "Environment: $ENVIRONMENT | Location: $LOCATION"

# Resource group for state storage
az group create --name "$RG" --location "$LOCATION" --output none
echo "Resource group: $RG"

# Storage account — LRS for tfstate (geo-redundancy is overkill; the state can be re-created)
az storage account create   --name "$STORAGE_ACCOUNT"   --resource-group "$RG"   --location "$LOCATION"   --sku Standard_LRS   --kind StorageV2   --min-tls-version TLS1_2   --allow-blob-public-access false   --output none
echo "Storage account: $STORAGE_ACCOUNT"

# Enable versioning so state file history is preserved
az storage account blob-service-properties update   --account-name "$STORAGE_ACCOUNT"   --enable-versioning true   --output none

# Blob container
az storage container create   --name "$CONTAINER"   --account-name "$STORAGE_ACCOUNT"   --output none
echo "Container: $CONTAINER"

# Service principal for GitHub Actions OIDC (no client secret stored)
APP_NAME="pulseway-github-actions-${ENVIRONMENT}"
APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
SP_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)

echo "Created service principal: $APP_NAME ($APP_ID)"

# Assign Contributor role scoped to subscription
az role assignment create   --assignee "$SP_ID"   --role "Contributor"   --scope "/subscriptions/$SUBSCRIPTION"   --output none

# Assign Key Vault Administrator role
az role assignment create   --assignee "$SP_ID"   --role "Key Vault Administrator"   --scope "/subscriptions/$SUBSCRIPTION"   --output none

# Configure federated credential for GitHub Actions OIDC
# Replace GITHUB_ORG and REPO_NAME with your actual values
GITHUB_ORG="${GITHUB_ORG:-your-github-org}"
REPO_NAME="${REPO_NAME:-pulseway}"

az ad app federated-credential create   --id "$APP_ID"   --parameters "{
    \"name\": \"github-actions-${ENVIRONMENT}\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${GITHUB_ORG}/${REPO_NAME}:environment:${ENVIRONMENT}\",
    \"description\": \"GitHub Actions OIDC for pulseway ${ENVIRONMENT}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"   --output none

echo ""
echo "=== Add these secrets to your GitHub repository ==="
echo "AZURE_CLIENT_ID       = $APP_ID"
echo "AZURE_TENANT_ID       = $(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID = $SUBSCRIPTION"
echo ""
echo "=== Run Terraform ==="
echo "cd infrastructure/azure"
echo "terraform init"
echo "terraform workspace new $ENVIRONMENT"
echo "terraform apply -var=environment=$ENVIRONMENT -var=custom_domain=your-domain.com -var=alert_email=ops@your-domain.com"
