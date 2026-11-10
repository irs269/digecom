# Web Dig'eCom (Next.js) – image multi-stage. Contexte de build : racine du monorepo.
# Compatible avec le builder classique de Docker (sans buildx ni cache monté).

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

# --- pwa : application mobile (e-commerçants, livreurs) exportée pour le web, servie sous /app
# (iPhone : installation depuis Safari, « Sur l'écran d'accueil »).
FROM base AS pwa
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter mobile... --filter digecom-platform --ignore-scripts
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/mobile apps/mobile
RUN pnpm --filter @digecom/shared build  && cd apps/mobile && npx expo export -p web --output-dir /pwa

# --- build : sortie Next.js « standalone ».
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web... --filter digecom-platform
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm --filter @digecom/shared build && pnpm --filter web build

# --- prod : serveur Node minimal, utilisateur non-root.
FROM node:22-alpine AS prod
RUN apk add --no-cache tini  && apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=pwa /pwa ./apps/web/public/app
# Cache d'images Next.js : seul dossier inscriptible.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD node -e "fetch('http://127.0.0.1:3000/connexion').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
