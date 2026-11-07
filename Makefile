# Dig'eCom – commandes de développement (tout s'exécute dans Docker).
# Sous Windows sans make : utilise ./make.ps1 <cible> (mêmes cibles).

COMPOSE ?= docker compose
API_EXEC = $(COMPOSE) exec api

.PHONY: help up down logs migrate seed test e2e lint psql reset build

help: ## Affiche cette aide
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-10s %s\n", $$1, $$2}'

up: ## Démarre postgres, redis, minio, api et web
	@test -f .env || (echo "Fichier .env absent : lance d'abord  cp .env.example .env" && exit 1)
	$(COMPOSE) up -d --build --wait api web
	@echo "Web : http://localhost:3000  ·  API : http://localhost:4000/api/docs"

down: ## Arrête les conteneurs (les données sont conservées)
	$(COMPOSE) down

logs: ## Suit les logs de tous les services
	$(COMPOSE) logs -f --tail=100

migrate: ## Applique les migrations Prisma (prisma migrate dev)
	$(API_EXEC) pnpm --filter api migrate

seed: ## Données de démonstration (mêmes noms que le prototype)
	$(API_EXEC) pnpm --filter api seed

test: ## Tests shared (Vitest) + API (unitaires et e2e)
	$(API_EXEC) pnpm test

e2e: ## Parcours web Playwright
	$(COMPOSE) --profile e2e run --rm e2e

lint: ## ESLint + Prettier --check + tsc --noEmit
	$(API_EXEC) pnpm lint

psql: ## Console SQL sur la base de développement
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

build: ## Construit les images de production (cible prod)
	docker build -f apps/api/Dockerfile --target prod -t digecom-api:local .
	docker build -f apps/web/Dockerfile --target prod -t digecom-web:local .

reset: ## Supprime conteneurs ET volumes (base, fichiers) après confirmation
	@printf "Cette commande SUPPRIME la base, Redis, MinIO et les node_modules Docker. Taper 'oui' pour confirmer : "; \
	read answer; [ "$$answer" = "oui" ] || (echo "Annulé." && exit 1)
	$(COMPOSE) --profile e2e down -v --remove-orphans
