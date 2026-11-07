#!/bin/sh
# Service `deps` : installe les dépendances (Linux) dans les volumes node_modules,
# compile packages/shared et génère le client Prisma. Les services api et web l'attendent.
set -e
cd /app
pnpm install --frozen-lockfile
pnpm --filter @digecom/shared build
pnpm --filter api exec prisma generate
echo "Dépendances prêtes."
