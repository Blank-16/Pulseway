FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/api/package.json ./packages/api/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN pnpm --filter @pulseway/types build 2>/dev/null || true
RUN pnpm --filter @pulseway/config build 2>/dev/null || true
RUN pnpm --filter @pulseway/db build 2>/dev/null || true
RUN pnpm --filter @pulseway/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S pulseway && adduser -S pulseway -G pulseway
COPY --from=build --chown=pulseway:pulseway /app/packages/api/dist ./dist
COPY --from=build --chown=pulseway:pulseway /app/node_modules ./node_modules
USER pulseway
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/server.js"]
