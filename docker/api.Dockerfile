FROM node:22-alpine AS base
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

FROM base AS deps
# Copy manifests for all packages so pnpm installs the full workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json      packages/types/
COPY packages/config/package.json     packages/config/
COPY packages/db/package.json         packages/db/
COPY packages/api/package.json        packages/api/
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/types      packages/types
COPY packages/config     packages/config
COPY packages/db         packages/db
COPY packages/api        packages/api
# tsc --build resolves the reference graph and builds only what's needed
RUN pnpm exec tsc --build packages/api/tsconfig.json

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build --chown=appuser:appgroup /app/packages/types/dist    packages/types/dist
COPY --from=build --chown=appuser:appgroup /app/packages/config/dist   packages/config/dist
COPY --from=build --chown=appuser:appgroup /app/packages/db/dist       packages/db/dist
COPY --from=build --chown=appuser:appgroup /app/packages/api/dist      packages/api/dist
COPY --from=deps  --chown=appuser:appgroup /app/node_modules           node_modules
COPY --from=deps  --chown=appuser:appgroup /app/packages/api/node_modules packages/api/node_modules

USER appuser
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health/ready || exit 1

CMD ["node", "--experimental-specifier-resolution=node", "packages/api/dist/server.js"]
