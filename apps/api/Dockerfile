# API Dig'eCom – image multi-stage. Contexte de build : racine du monorepo.
# Compatible avec le builder classique de Docker (sans buildx ni cache monté).
#   docker build -f apps/api/Dockerfile --target dev     .
#   docker build -f apps/api/Dockerfile --target migrate .   # migrations, create-admin, droits
#   docker build -f apps/api/Dockerfile --target prod    .   # API (et worker)

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

# --- build : installe (dépendances de dev comprises) et compile shared + api.
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api... --filter digecom-platform
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @digecom/shared build \
 && pnpm --filter api exec prisma generate \
 && pnpm --filter api build

# --- migrate : CLI prisma et tsx disponibles (dépendances de dev), usage ponctuel.
#   prisma migrate deploy + droits du rôle applicatif (CMD par défaut) ;
#   pnpm --filter api create-admin (premier administrateur, interactif).
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /app
CMD ["sh", "-c", "pnpm --filter api exec prisma migrate deploy && node apps/api/dist/cli/db-grants.js"]

# --- deploy : dépendances de production uniquement.
FROM build AS deploy
RUN pnpm deploy --filter api --prod /out \
 && cp -r apps/api/prisma /out/prisma \
 && cd /out && /app/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma

# --- prod : image minimale, utilisateur non-root, ni CLI prisma ni tsx.
FROM node:22-alpine AS prod
RUN apk add --no-cache openssl tini \
 && apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production PORT=4000 NODE_OPTIONS=--enable-source-maps
COPY --from=deploy /out /app
COPY docs/brand/logo-digecom.jpg /app/assets/logo-digecom.jpg
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
