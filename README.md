# Pulseway

API health monitoring with sub-200ms alert delivery.

## Architecture

```
apps/
  web/               Next.js 16 (App Router, React 19, Tailwind 4)
packages/
  api/               Express 5 REST API + SSE
  scheduler/         SQS job enqueuer (polls DB every 10s)
  worker/            SQS consumer (HTTP checks + incident logic + alerts)
  db/                pg repositories + migrations
  types/             Shared TypeScript types
  config/            Zod-validated env config + Secrets Manager
infrastructure/
  modules/           Terraform modules (VPC, RDS, ElastiCache, SQS, ECS, ALB, WAF, CloudFront, SES)
  environments/      staging + prod tfvars
tests/
  integration/       Supertest API tests + unit tests
  smoke/             Post-deploy health checks
```

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS |
| Package manager | pnpm 10 (workspaces) |
| Build orchestration | Turbo 2 |
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| API | Express 5.2, Zod 4, jsonwebtoken 9 |
| Database | PostgreSQL 16 (Aurora Serverless v2) |
| Cache / pub-sub | Redis 7 (ElastiCache) |
| Queue | AWS SQS FIFO |
| Email | AWS SES |
| Auth | httpOnly refresh token cookie + short-lived JWT |
| Billing | Stripe |
| Infra | Terraform + AWS ECS Fargate |
| CI/CD | GitHub Actions (OIDC, no long-lived keys) |

## Local Development

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker + Docker Compose
- AWS CLI with LocalStack support (`pip install awscli-local`)

### Setup

```bash
# 1. Start local services
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Copy and fill environment
cp .env.example .env

# 4. Set up LocalStack queues and secrets
bash scripts/setup-localstack.sh

# 5. Run database migrations
pnpm --filter @pulseway/db migrate

# 6. Seed local data
pnpm tsx scripts/seed.ts

# 7. Start all services
pnpm dev
```

Services will be available at:
- Web: http://localhost:3000
- API: http://localhost:4000
- Health: http://localhost:4000/health

### Development credentials (after seed)

```
Email:    dev@pulseway.dev
Password: password123
```

## Testing

```bash
# Unit + integration tests
pnpm test

# Typecheck all packages
pnpm typecheck

# Smoke tests against a running instance
SMOKE_API_URL=http://localhost:4000 pnpm test:smoke
```

## Infrastructure

```bash
cd infrastructure

# Init (first time)
terraform init

# Plan staging
terraform plan -var-file=environments/staging/terraform.tfvars

# Apply staging
terraform apply -var-file=environments/staging/terraform.tfvars

# Apply prod (requires manual approval via GitHub Actions environment)
terraform apply -var-file=environments/prod/terraform.tfvars
```

## Deployment

Push to `main` → automatic staging deploy.
Prod deploys are triggered manually via GitHub Actions `workflow_dispatch` with `environment=prod`.

```bash
gh workflow run deploy.yml -f environment=prod
```

## Database Maintenance

Partition maintenance runs monthly to pre-create `check_results` partitions:

```bash
pnpm tsx scripts/maintain-partitions.ts
```

Schedule this via AWS EventBridge or a cron ECS task in production.
