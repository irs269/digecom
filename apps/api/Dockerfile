# syntax=docker/dockerfile:1.7
# API Dig'eCom – image multi-stage. Contexte de build : racine du monorepo.
#   docker build -f apps/api/Dockerfile --target dev  .
#   docker build -f apps/api/Dockerfile --target prod .

FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@9.15.9 --activate
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
WORKDIR /app

# --- dev : le code est monté en volume, les dépendances sont installées par le service `deps`.
FROM base AS dev
RUN chown node:node /app && mkdir -p /pnpm/store && chown -R node:node /pnpm
USER node
ENV NODE_ENV=development
EXPOSE 4000
CMD ["pnpm", "--filter", "api", "start:dev"]

# --- build : installe et compile shared + api.
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile \
    --filter api... --filter digecom-platform
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @digecom/shared build \
 && pnpm --filter api exec prisma generate \
 && pnpm --filter api build \
 && pnpm deploy --filter api --prod /out \
 && cp -r apps/api/prisma /out/prisma \
 && cd /out && npx --yes prisma@5.22.0 generate --schema prisma/schema.prisma

# --- prod : image minimale, utilisateur non-root.
FROM node:22-alpine AS prod
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
