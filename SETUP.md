# Setup Guide

This project runs on **Azure** (current) and **AWS** (available when ready). Both are fully supported. The architecture maps 1:1 across clouds:

| Component | Azure | AWS |
|---|---|---|
| Container runtime | Azure Container Apps (ACA) | ECS Fargate |
| Message queue | Azure Service Bus | SQS FIFO |
| Database | Postgres Flexible Server | Aurora Serverless v2 |
| Cache | Azure Cache for Redis | ElastiCache Redis |
| Container registry | Azure Container Registry (ACR) | ECR |
| Secrets | Azure Key Vault | AWS Secrets Manager |
| CDN + WAF | Azure Front Door | CloudFront + WAF v2 |
| Email | Azure Communication Services / SendGrid | SES |
| Monitoring | Azure Monitor + App Insights | CloudWatch |
| DNS | Azure DNS | Route 53 |
| Infra-as-Code | `infrastructure/azure/` | `infrastructure/` |

---

## Prerequisites

```bash
# Required on your local machine
node >= 24
pnpm >= 10     (corepack enable && corepack prepare pnpm@latest --activate)
terraform >= 1.10
docker
az CLI >= 2.65  (Azure setup)
aws CLI >= 2    (AWS setup — optional until you switch)
```

---

## Azure Setup

### Step 1 — Log in and select subscription

```bash
az login
az account set --subscription "<your-subscription-id>"
az account show   # confirm correct subscription
```

### Step 2 — Bootstrap Terraform state storage

This creates the storage account and service principal that Terraform uses. Run **once per subscription**.

```bash
export GITHUB_ORG="your-github-org"
export REPO_NAME="pulseway"

bash scripts/bootstrap-azure.sh staging eastus
```

The script prints three values. Add them as **GitHub repository secrets**:

| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | Printed by script |
| `AZURE_TENANT_ID` | Printed by script |
| `AZURE_SUBSCRIPTION_ID` | Printed by script |

### Step 3 — Initialise Terraform

```bash
cd infrastructure/azure
terraform init
terraform workspace new staging
```

### Step 4 — Provision staging infrastructure

```bash
terraform apply \
  -var="environment=staging" \
  -var="custom_domain=yourdomain.com" \
  -var="alert_email=ops@yourdomain.com" \
  -var="location=eastus"
```

This creates (in order, ~15 minutes):
1. Resource group `pulseway-staging`
2. VNet with subnets for ACA, Postgres, Redis
3. ACR (Basic SKU in staging)
4. Key Vault
5. Postgres Flexible Server 16 (writes connection string to Key Vault)
6. Azure Cache for Redis (Basic SKU in staging, TLS enforced)
7. Service Bus namespace + `check-jobs` and `alert-jobs` queues
8. Container Apps environment (internal VNet-injected)
9. Four Container Apps: api, worker, scheduler, web
10. Azure Front Door Standard with WAF
11. Azure Monitor alerts + Application Insights
12. DNS records (staging only adds CNAME if a zone already exists)

### Step 5 — Store application secrets in Key Vault

Terraform writes DB and Redis connection strings automatically. Add the remaining secrets manually:

```bash
KV_NAME=$(terraform output -raw keyvault_name)

# JWT secret (min 32 chars)
az keyvault secret set --vault-name "$KV_NAME" --name "jwt-secret" \
  --value "$(openssl rand -hex 32)"

# Stripe keys
az keyvault secret set --vault-name "$KV_NAME" --name "stripe-secret-key" \
  --value "sk_test_..."
az keyvault secret set --vault-name "$KV_NAME" --name "stripe-webhook-sig" \
  --value "whsec_..."

# Metrics bearer token
az keyvault secret set --vault-name "$KV_NAME" --name "metrics-token" \
  --value "$(openssl rand -hex 32)"

# Service Bus connection strings (Terraform outputs them)
az keyvault secret set --vault-name "$KV_NAME" --name "servicebus-check-conn-str" \
  --value "$(terraform output -raw check_send_conn_str)"
az keyvault secret set --vault-name "$KV_NAME" --name "servicebus-alert-conn-str" \
  --value "$(terraform output -raw alert_receive_conn_str)"
```

### Step 6 — Run database migrations

```bash
# Get the API FQDN
API_FQDN=$(terraform output -raw api_fqdn)
RG=$(terraform output -raw resource_group)
ACR=$(terraform output -raw acr_login_server)

# Log in to ACR and push the initial image
az acr login --name $(terraform output -raw acr_login_server | cut -d. -f1)

# Build and push (or trigger the GitHub Actions workflow)
docker build -f packages/api/Dockerfile -t ${ACR}/pulseway-api:init .
docker push ${ACR}/pulseway-api:init

# Run migration as a one-shot Container App job
az containerapp job create \
  --name "pulseway-staging-migrate-init" \
  --resource-group "$RG" \
  --environment "pulseway-staging-env" \
  --trigger-type Manual \
  --replica-timeout 300 \
  --image "${ACR}/pulseway-api:init" \
  --cpu 0.25 --memory 0.5Gi \
  --env-vars "NODE_ENV=production" \
  --mi-user-assigned "/subscriptions/$(az account show --query id -o tsv)/resourcegroups/${RG}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/pulseway-staging-aca" \
  --command "node" "packages/db/dist/migrate.js"

az containerapp job start --name "pulseway-staging-migrate-init" --resource-group "$RG"
```

### Step 7 — Seed development data (staging only)

```bash
# Connect to Postgres via az CLI tunnel (no public endpoint)
az postgres flexible-server connect \
  --name "pulseway-staging-pg" \
  --admin-user pulseway_admin \
  --admin-password "$(az keyvault secret show --vault-name "$KV_NAME" --name database-url --query value -o tsv | grep -oP '(?<=:)[^@]+(?=@)')"
```

Or run the seed script against the remote DB by setting `DATABASE_URL` locally:

```bash
export DATABASE_URL="$(az keyvault secret show --vault-name "$KV_NAME" --name database-url --query value -o tsv)"
pnpm exec tsx scripts/seed.ts
```

### Step 8 — Deploy via GitHub Actions

Push to `main` — the `deploy-azure.yml` workflow triggers automatically for staging. For production:

```bash
# Go to GitHub → Actions → Deploy (Azure) → Run workflow → select prod
```

The workflow:
1. Runs typecheck + unit tests
2. Builds and pushes all four Docker images to ACR
3. Runs DB migrations via a Container App Job
4. Updates all four Container Apps with the new image tag
5. Smoke-tests `/health/ready`

### Setting environment-specific variables

Each Container App has environment variables. Update via CLI or Terraform:

```bash
az containerapp update \
  --name "pulseway-staging-api" \
  --resource-group "pulseway-staging" \
  --set-env-vars "CLOUD=azure" "NODE_ENV=production" \
    "WORKER_REGION=eastus" "DB_POOL_MAX=10"
```

Secrets are always read from Key Vault — never set as plaintext env vars.

### Scaling

Workers scale automatically on Service Bus queue depth via KEDA (built into ACA):

```
queue depth > 100  → scale out
queue depth < 10   → scale in (after 5min cooldown)
min replicas: 2 (prod), 1 (staging)
max replicas: 20 (prod), 5 (staging)
```

API scales on HTTP concurrent requests (>50 per replica).

---

## Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres, Redis, LocalStack (SQS emulator)
make docker-up

# 3. Run migrations and seed
make migrate
make seed

# 4. Start all services
make dev
```

Services:
- API:       http://localhost:4000
- Web:       http://localhost:3000
- API docs:  http://localhost:4000/api/docs
- LocalStack: http://localhost:4566

Default seed credentials: `dev@pulseway.dev` / `password123`

### Using Azure Service Bus locally

If you want to test against real Azure Service Bus (instead of LocalStack SQS):

```bash
# Get connection strings from Key Vault
export AZURE_SERVICEBUS_CHECK_CONN_STR="$(az keyvault secret show --vault-name pulseway-staging-kv --name servicebus-check-conn-str --query value -o tsv)"
export AZURE_SERVICEBUS_ALERT_CONN_STR="$(az keyvault secret show --vault-name pulseway-staging-kv --name servicebus-alert-conn-str --query value -o tsv)"
export CLOUD=azure
```

---

## AWS Setup (when ready)

AWS infrastructure lives in `infrastructure/` and uses Terraform with an S3 backend.

### Step 1 — Bootstrap state bucket

```bash
aws s3api create-bucket --bucket pulseway-tfstate --region us-east-1
aws s3api put-bucket-versioning --bucket pulseway-tfstate \
  --versioning-configuration Status=Enabled
aws dynamodb create-table \
  --table-name pulseway-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### Step 2 — Create GitHub Actions OIDC role

```bash
# Create the OIDC provider (once per AWS account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create IAM role for GitHub Actions
aws iam create-role \
  --role-name pulseway-github-actions \
  --assume-role-policy-document file://infrastructure/iam/github-actions-trust.json

aws iam attach-role-policy \
  --role-name pulseway-github-actions \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

Add `AWS_ACCOUNT_ID` as a GitHub secret.

### Step 3 — Provision infrastructure

```bash
cd infrastructure
terraform init
terraform workspace new staging
terraform apply \
  -var="environment=staging" \
  -var="email_domain=yourdomain.com" \
  -var="acm_certificate_arn=arn:aws:acm:us-east-1:..." \
  -var="cloudfront_certificate_arn=arn:aws:acm:us-east-1:..." \
  -var="alarm_sns_topic_arn=arn:aws:sns:us-east-1:..."
```

### Step 4 — Store secrets in Secrets Manager

```bash
aws secretsmanager create-secret --name pulseway/staging/jwt-secret \
  --secret-string "$(openssl rand -hex 32)"
aws secretsmanager create-secret --name pulseway/staging/stripe-secret-key \
  --secret-string "sk_test_..."
aws secretsmanager create-secret --name pulseway/staging/stripe-webhook-sig \
  --secret-string "whsec_..."
```

### Step 5 — Deploy

Push to `main` — `deploy.yml` (existing AWS workflow) triggers automatically.

---

## Environment variables reference

The canonical list is `packages/config/src/index.ts` (Zod schema). Key variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `REDIS_URL` | Yes | `rediss://:pass@host:6380` (Azure) or `redis://host:6379` |
| `JWT_SECRET` | Yes | Min 32 chars random string |
| `JWT_SECRET_PREVIOUS` | No | Previous JWT secret during rotation |
| `STRIPE_SECRET_KEY` | Yes | `sk_live_...` or `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Yes | `whsec_...` |
| `STRIPE_PRICE_PRO_MONTHLY` | Yes | Stripe price ID `price_...` |
| `STRIPE_PRICE_TEAM_MONTHLY` | Yes | Stripe price ID `price_...` |
| `APP_ORIGIN` | Yes | `https://app.yourdomain.com` |
| `CLOUD` | No | `aws` (default) or `azure` |
| `AWS_REGION` | AWS | e.g. `us-east-1` |
| `CHECK_JOBS_QUEUE_URL` | AWS | SQS queue URL |
| `ALERT_JOBS_QUEUE_URL` | AWS | SQS queue URL |
| `AZURE_SERVICEBUS_CHECK_CONN_STR` | Azure | Service Bus connection string for check-jobs queue |
| `AZURE_SERVICEBUS_ALERT_CONN_STR` | Azure | Service Bus connection string for alert-jobs queue |
| `AZURE_KEYVAULT_URI` | Azure | `https://pulseway-staging-kv.vault.azure.net/` |
| `WORKER_REGION` | No | AWS region or Azure location this worker serves |
| `METRICS_TOKEN` | Prod | Bearer token for `/metrics` endpoint |
| `DB_POOL_MAX` | No | pg connection pool size (default 10) |
| `PGBOUNCER` | No | `true` disables prepared statements for PgBouncer compat |
| `SES_FROM_ADDRESS` | AWS | Verified SES sender address |

---

## Production checklist

### Before first production deploy

- [ ] Custom domain verified in Azure Front Door or ACR
- [ ] TLS certificate issued (Front Door manages this automatically)
- [ ] Key Vault purge protection enabled (set `var.environment = "prod"` in Terraform)
- [ ] Postgres deletion protection enabled (`var.environment = "prod"`)
- [ ] Redis AOF persistence enabled (Premium SKU required)
- [ ] Alert email set and tested (`var.alert_email`)
- [ ] `METRICS_TOKEN` set in Key Vault
- [ ] All Stripe price IDs set to live mode `price_live_...`
- [ ] `JWT_SECRET` rotated from staging value
- [ ] `APP_ORIGIN` set to production domain
- [ ] DB migrations run against production database
- [ ] Feature flags reviewed (`GET /api/flags/workspace/:id`)

### Ongoing

- [ ] Rotate `JWT_SECRET` every 90 days (zero-downtime via `JWT_SECRET_PREVIOUS`)
- [ ] Review `audit_events` table weekly for suspicious activity
- [ ] Run `make partitions` on 1st of each month (or set up a cron job)
- [ ] Monitor DLQ depth — any messages there indicate a recurring worker failure
- [ ] Review Renovate PRs weekly — merge security patches immediately

---

## Architecture diagram

```
Browser / Mobile
      |
Azure Front Door (CDN + WAF + TLS)
      |
      +---> /api/*  -->  Container Apps: API (2-10 replicas, autoscales on HTTP)
      |                        |
      +---> /*      -->  Container Apps: Web (Next.js, 2-5 replicas)
                               |
                    +-----------+------------+
                    |                        |
             Postgres Flexible        Azure Cache for Redis
             Server (HA, ZR)          (TLS, LRU eviction)
                    |
          Container Apps: Scheduler (1 replica, distributed lock)
                    |
             Azure Service Bus
             check-jobs queue
                    |
          Container Apps: Worker (2-20 replicas, KEDA queue-depth autoscale)
                    |
             Azure Service Bus
             alert-jobs queue
                    |
          Container Apps: Worker (alert path)
```

---

## Troubleshooting

### Container App not starting

```bash
az containerapp logs show \
  --name "pulseway-staging-api" \
  --resource-group "pulseway-staging" \
  --follow
```

### Migration job failed

```bash
az containerapp job execution list \
  --name "pulseway-staging-migrate" \
  --resource-group "pulseway-staging" \
  --query "[0].{status:properties.status,startTime:properties.startTime}"
```

### Postgres connection refused

Postgres has no public endpoint. Connect via Azure CLI:

```bash
az postgres flexible-server connect \
  --name "pulseway-staging-pg" \
  --admin-user pulseway_admin
```

### Key Vault access denied

Check that the Container App's managed identity has the `Key Vault Secrets User` role:

```bash
az role assignment list \
  --scope "$(az keyvault show --name pulseway-staging-kv --query id -o tsv)" \
  --query "[].{principal:principalName,role:roleDefinitionName}"
```

### Worker not processing messages

Check Service Bus queue depth:

```bash
az servicebus queue show \
  --name check-jobs \
  --namespace-name "pulseway-staging-sb" \
  --resource-group "pulseway-staging" \
  --query "countDetails"
```

Check KEDA scaling events:

```bash
az monitor metrics list \
  --resource "$(az containerapp show --name pulseway-staging-worker --resource-group pulseway-staging --query id -o tsv)" \
  --metric "RunningReplicas" \
  --interval PT1M \
  --output table
```
