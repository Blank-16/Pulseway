FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/worker/package.json ./packages/worker/
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
RUN pnpm --filter @pulseway/worker build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S pulseway && adduser -S pulseway -G pulseway
COPY --from=build --chown=pulseway:pulseway /app/packages/worker/dist ./dist
COPY --from=build --chown=pulseway:pulseway /app/node_modules ./node_modules
USER pulseway
CMD ["node", "dist/index.js"]
