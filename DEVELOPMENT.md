# Development Guide

## Prerequisites

- Node.js >= 22
- pnpm >= 10 (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker + Docker Compose (for Postgres, Redis, LocalStack)

## First-time setup

```bash
pnpm install
make docker-up
make migrate
make seed
```

## Running locally

```bash
# All services in parallel (API, worker, scheduler, web)
make dev

# Or individually
pnpm -C packages/api       run dev   # http://localhost:4000
pnpm -C packages/scheduler run dev
pnpm -C packages/worker    run dev
pnpm -C apps/web           run dev   # http://localhost:3000
```

Default dev credentials (from seed): `dev@pulseway.dev` / `password123`

## Build system

This project uses **pnpm workspaces** + **TypeScript project references** (`tsc --build`).

There is no Turborepo. The TypeScript compiler handles the dependency graph natively.

### How it works

```
tsc --build          ← reads root tsconfig.json (solution file)
  → builds types     ← no deps, builds first
  → builds config    ← no deps, builds first (parallel with types)
  → builds db        ← depends on types + config, waits for both
  → builds api       ← depends on db (and transitively types + config)
  → builds worker    ← depends on db (parallel with api)
  → builds scheduler ← depends on db (parallel with api + worker)
```

`tsc --build` is **incremental**: it reads `.tsbuildinfo` files and skips packages whose source files haven't changed. Changing one file in `packages/db` rebuilds `db`, `api`, `worker`, and `scheduler`, and skips `types` and `config`.

### Common commands

| Command | What it does |
|---|---|
| `make build` | Incremental build of all packages |
| `make build:clean` | Clean all dist/ + tsbuildinfo, then full rebuild |
| `make build:watch` | Watch mode — rebuilds on every file save |
| `make typecheck` | Type-check only (no emit) — fast CI feedback |
| `pnpm exec tsc --build packages/api/tsconfig.json` | Build only api and its dependencies |

### When to run a clean build

- After a git merge that changes `tsconfig.base.json` or any package's `tsconfig.json`
- If you see stale type errors that disappear after a rebuild
- After switching branches with significant package-level changes

```bash
make clean && make build
```

## Testing

```bash
make test                  # unit tests (vitest)
make test:integration      # starts Docker, runs real DB/Redis tests
make test:smoke            # smoke tests against a running API
```

## Database

```bash
make migrate               # run pending migrations
make seed                  # truncate + reseed dev data
make partitions            # create next 3 months of check_results partitions
```

Migrations are in `packages/db/src/migrations/` — numbered SQL files.
The migration runner computes a SHA-256 checksum per file and stores it in
`schema_migrations`. **Never edit a migration file after it has been applied.**

## Environment

Copy `.env.example` to `.env` and fill in values. The config schema
(`packages/config/src/index.ts`) validates all vars at startup with Zod —
missing or malformed vars cause an immediate descriptive error.

For local dev, `AWS_ENDPOINT_URL=http://localhost:4566` points at LocalStack.

## API docs

With the API running: `http://localhost:4000/api/docs` (RapiDoc UI)
Raw OpenAPI spec: `http://localhost:4000/api/openapi.json`
