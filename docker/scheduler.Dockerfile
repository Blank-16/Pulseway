FROM node:24-alpine AS base
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json     packages/types/
COPY packages/config/package.json    packages/config/
COPY packages/db/package.json        packages/db/
COPY packages/scheduler/package.json packages/scheduler/
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/types     packages/types
COPY packages/config    packages/config
COPY packages/db        packages/db
COPY packages/scheduler packages/scheduler
RUN pnpm exec tsc --build packages/scheduler/tsconfig.json

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build --chown=appuser:appgroup /app/packages/types/dist      packages/types/dist
COPY --from=build --chown=appuser:appgroup /app/packages/config/dist     packages/config/dist
COPY --from=build --chown=appuser:appgroup /app/packages/db/dist         packages/db/dist
COPY --from=build --chown=appuser:appgroup /app/packages/scheduler/dist  packages/scheduler/dist
COPY --from=deps  --chown=appuser:appgroup /app/node_modules             node_modules

USER appuser
CMD ["node", "--experimental-specifier-resolution=node", "packages/scheduler/dist/index.js"]
