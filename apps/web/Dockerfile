FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json           apps/web/
COPY packages/types/package.json     packages/types/
RUN pnpm install --frozen-lockfile

FROM deps AS build
# types must be compiled before Next.js can resolve @pulseway/types
COPY tsconfig.base.json tsconfig.json ./
COPY packages/types packages/types
RUN pnpm exec tsc --build packages/types/tsconfig.json
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm -C apps/web run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S pulseway && adduser -S pulseway -G pulseway
COPY --from=build --chown=pulseway:pulseway /app/apps/web/.next/standalone ./
COPY --from=build --chown=pulseway:pulseway /app/apps/web/.next/static     apps/web/.next/static
COPY --from=build --chown=pulseway:pulseway /app/apps/web/public           apps/web/public
USER pulseway
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
