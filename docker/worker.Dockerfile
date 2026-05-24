FROM node:24-alpine AS base
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json     packages/types/
COPY packages/config/package.json    packages/config/
COPY packages/db/package.json        packages/db/
COPY packages/worker/package.json    packages/worker/
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/types     packages/types
COPY packages/config    packages/config
COPY packages/db        packages/db
COPY packages/worker    packages/worker
RUN pnpm exec tsc --build packages/worker/tsconfig.json

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build --chown=appuser:appgroup /app/packages/types/dist    packages/types/dist
COPY --from=build --chown=appuser:appgroup /app/packages/config/dist   packages/config/dist
COPY --from=build --chown=appuser:appgroup /app/packages/db/dist       packages/db/dist
COPY --from=build --chown=appuser:appgroup /app/packages/worker/dist   packages/worker/dist
COPY --from=deps  --chown=appuser:appgroup /app/node_modules           node_modules
COPY --from=deps  --chown=appuser:appgroup /app/packages/worker/node_modules packages/worker/node_modules

USER appuser
CMD ["node", "--experimental-specifier-resolution=node", "packages/worker/dist/index.js"]
