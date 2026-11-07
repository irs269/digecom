# syntax=docker/dockerfile:1.7
# Web Dig'eCom (Next.js) – image multi-stage. Contexte de build : racine du monorepo.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@9.15.9 --activate
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- dev : code monté en volume.
FROM base AS dev
RUN chown node:node /app && mkdir -p /pnpm/store && chown -R node:node /pnpm
USER node
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "dev"]

# --- build : sortie Next.js « standalone ».
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile \
    --filter web... --filter digecom-platform
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm --filter @digecom/shared build && pnpm --filter web build

# --- prod : serveur Node minimal, utilisateur non-root.
FROM node:22-alpine AS prod
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
