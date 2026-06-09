.PHONY: dev test test-integration test-smoke build typecheck lint migrate seed clean docker-up docker-down partitions help

# Start full dev stack (run docker-up first, then each process in background)
dev: docker-up
	@echo "Waiting for services..." && sleep 3
	$(MAKE) migrate
	pnpm -C packages/api       run dev &
	pnpm -C packages/worker    run dev &
	pnpm -C packages/scheduler run dev &
	pnpm -C apps/web           run dev

# Build all packages via TypeScript project references (incremental, correct order)
build:
	pnpm exec tsc --build

# Rebuild from scratch — clears tsbuildinfo caches
build:clean:
	find packages apps -name "tsconfig.tsbuildinfo" -delete
	find packages apps -name "dist" -type d ! -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null; true
	pnpm exec tsc --build

# Watch mode — rebuilds only changed packages
build:watch:
	pnpm exec tsc --build --watch

# Type-check without emitting (dry run — fast CI feedback)
typecheck:
	pnpm exec tsc --build --dry

test:
	pnpm exec vitest run

test:integration: docker-up
	@sleep 3
	pnpm exec vitest run --config vitest.integration.config.ts

test:smoke:
	SMOKE_API_URL=http://localhost:4000 pnpm exec vitest run tests/smoke

lint:
	pnpm exec eslint packages apps --ext .ts,.tsx

# Database
migrate:
	pnpm -C packages/db run migrate

seed: migrate
	pnpm exec tsx scripts/seed.ts

# Infrastructure
docker-up:
	docker compose -f docker-compose.dev.yml up -d

docker-down:
	docker compose -f docker-compose.dev.yml down -v

# Partition maintenance (run monthly via cron)
partitions:
	pnpm exec tsx scripts/maintenance.ts

# Remove all build artefacts and tsbuildinfo caches
clean:
	find packages apps -name "dist" -type d ! -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null; true
	find packages apps -name "tsconfig.tsbuildinfo" -delete
	find packages apps -name ".next" -type d ! -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null; true

# Azure infrastructure
azure-bootstrap:
	bash scripts/bootstrap-azure.sh $(ENV) $(LOCATION)

azure-init:
	cd infrastructure/azure && terraform init

azure-plan:
	cd infrastructure/azure && terraform plan -var-file=environments/$(ENV).tfvars -var=custom_domain=$(DOMAIN) -var=alert_email=$(ALERT_EMAIL)

azure-apply:
	cd infrastructure/azure && terraform apply -var-file=environments/$(ENV).tfvars -var=custom_domain=$(DOMAIN) -var=alert_email=$(ALERT_EMAIL)

azure-destroy:
	cd infrastructure/azure && terraform destroy -var-file=environments/$(ENV).tfvars -var=custom_domain=$(DOMAIN) -var=alert_email=$(ALERT_EMAIL)

azure-migrate:
	az containerapp job start --name "pulseway-$(ENV)-migrate" --resource-group "pulseway-$(ENV)"

azure-logs-api:
	az containerapp logs show --name "pulseway-$(ENV)-api" --resource-group "pulseway-$(ENV)" --follow

azure-logs-worker:
	az containerapp logs show --name "pulseway-$(ENV)-worker" --resource-group "pulseway-$(ENV)" --follow

azure-secrets:
	KV_NAME=pulseway-$(ENV)-kv && 	az keyvault secret set --vault-name "$$KV_NAME" --name "jwt-secret" --value "$$(openssl rand -hex 32)" && 	echo "Set jwt-secret. Set stripe keys manually."


help:
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development"
	@echo "  dev                 Start all services (API, worker, scheduler, web)"
	@echo "  build               Incremental build (tsc --build)"
	@echo "  build:clean         Clean build from scratch"
	@echo "  build:watch         Watch mode — rebuilds on change"
	@echo "  typecheck           Type-check without emitting"
	@echo ""
	@echo "Testing"
	@echo "  test                Unit tests"
	@echo "  test:integration    Integration tests (starts Docker)"
	@echo "  test:smoke          Smoke tests against running API"
	@echo ""
	@echo "Database"
	@echo "  migrate             Run pending migrations"
	@echo "  seed                Truncate + reseed dev data"
	@echo ""
	@echo "Infrastructure"
	@echo "  docker-up           Start Postgres + Redis + LocalStack"
	@echo "  docker-down         Stop and remove dev containers + volumes"
	@echo "  partitions          Create next 3 months of check_results partitions"
	@echo ""
	@echo "  clean               Remove all dist/ and tsbuildinfo files"
	@echo ""
	@echo "Azure"
	@echo "  azure-bootstrap     Bootstrap tfstate storage and OIDC service principal"
	@echo "  azure-init          terraform init for Azure"
	@echo "  azure-plan          terraform plan (ENV=staging|prod DOMAIN=x.com ALERT_EMAIL=y)"
	@echo "  azure-apply         terraform apply"
	@echo "  azure-migrate       Run DB migrations via Container App Job"
	@echo "  azure-logs-api      Tail API Container App logs"
	@echo "  azure-logs-worker   Tail worker Container App logs"
	@echo "  azure-secrets       Set JWT secret in Key Vault"
	@echo "  lint                Run ESLint across all packages"
	@echo ""
