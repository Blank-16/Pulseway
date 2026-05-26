FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/worker/package.json    packages/worker/
COPY packages/db/package.json        packages/db/
COPY packages/types/package.json     packages/types/
COPY packages/config/package.json    packages/config/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/types     packages/types
COPY packages/config    packages/config
COPY packages/db        packages/db
COPY packages/worker    packages/worker
RUN pnpm exec tsc --build packages/worker/tsconfig.json

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S pulseway && adduser -S pulseway -G pulseway
COPY --from=build --chown=pulseway:pulseway /app/packages/types/dist   packages/types/dist
COPY --from=build --chown=pulseway:pulseway /app/packages/config/dist  packages/config/dist
COPY --from=build --chown=pulseway:pulseway /app/packages/db/dist      packages/db/dist
COPY --from=build --chown=pulseway:pulseway /app/packages/worker/dist  packages/worker/dist
COPY --from=deps  --chown=pulseway:pulseway /app/node_modules          node_modules
USER pulseway
CMD ["node", "--experimental-specifier-resolution=node", "packages/worker/dist/index.js"]
