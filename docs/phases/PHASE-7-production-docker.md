# Phase 7 – Mise en production avec Docker, sécurité, sauvegardes

> Prérequis : phases 0 à 6 terminées. Relis `CLAUDE.md`, `docs/SPEC.md` §8 et `docs/PROGRESS.md`.

## Objectif

L'application web et l'API tournent en production sur un serveur Linux (VPS) avec **Docker Compose**, en HTTPS, avec sauvegardes automatiques testées, supervision minimale et procédure de mise à jour sans perte de données.

Propose d'abord l'architecture de production et la liste des variables d'environnement, puis implémente.

## À réaliser

### Images et compose de production
- Images `api` et `web` multi-stage, minimales (node:22-alpine ou distroless), non-root, `NODE_ENV=production`, Next.js en mode `standalone`, `HEALTHCHECK`.
- `compose.prod.yml` : `caddy` (reverse proxy, HTTPS automatique Let's Encrypt, domaines `app.<domaine>` → web, `api.<domaine>` → api, en-têtes de sécurité, compression), `web`, `api`, `worker` (même image que l'api, lance les jobs BullMQ), `postgres` (non exposé, volume, `shared_buffers` adapté), `redis` (mot de passe, non exposé), `minio` (ou S3 externe via variables), `backup`.
- Migrations appliquées par un service `migrate` à usage unique (`prisma migrate deploy`) avant le démarrage de l'api.
- `restart: unless-stopped`, limites mémoire, logs JSON avec rotation.
- Publication des images sur GitHub Container Registry par la CI (tag = commit + `latest`), déploiement par `docker compose pull && docker compose up -d`.

### Sécurité
- Secrets uniquement via `.env.prod` (hors dépôt) ou Docker secrets ; rotation documentée.
- CORS limité aux domaines, cookies `Secure`, CSP stricte, HSTS, `helmet`, rate limiting global et par route sensible, taille de requête limitée, validation des fichiers (type, taille, antivirus facultatif).
- Rôle PostgreSQL applicatif sans DDL et sans UPDATE/DELETE sur `LedgerEntry` et `AuditLog`.
- `pnpm audit` et scan d'image (Trivy) dans la CI ; échec si vulnérabilité critique.
- Désactivation de Swagger et du simulateur de dev en production.
- Changement obligatoire du mot de passe des comptes seedés ; seed de démonstration interdit en production (seed « production » minimal : îles, sites, admin).

### Sauvegardes et restauration
- Service `backup` : `pg_dump` quotidien compressé et chiffré, rétention 7 jours + 4 semaines + 6 mois, copie hors serveur (bucket S3 externe), sauvegarde des buckets MinIO.
- Script `make restore BACKUP=…` et **test de restauration** automatisé sur une base temporaire (CI hebdomadaire ou commande manuelle) qui vérifie le nombre de commandes et d'écritures.

### Supervision
- `/health` et `/ready` ; Uptime Kuma (ou équivalent) dans le compose avec alerte e-mail/WhatsApp.
- Journaux centralisés (Loki + Grafana facultatif) ; tableau de bord simple : erreurs 5xx, latence, jobs en échec.
- Alerte si un job (abonnements, règlements) échoue.

### Documentation
- `docs/DEPLOIEMENT.md` : choix du serveur (2 vCPU, 4 Go RAM, 80 Go SSD minimum), DNS, installation de Docker, premier déploiement, mise à jour, retour arrière, restauration, rotation des secrets.
- `docs/EXPLOITATION.md` : comptes, paramètres, que faire si un livreur ne reçoit rien, si un relevé est faux, etc.
- Guide utilisateur par rôle (une page par rôle, captures d'écran) dans `docs/guides/`.

### Recette
- Script de recette (Playwright) qui joue les critères de validation globaux de la SPEC §9 contre l'environnement de préproduction.

## Critères d'acceptation
- [ ] Déploiement reproductible sur un serveur vierge en suivant `DEPLOIEMENT.md`.
- [ ] HTTPS valide, note A sur securityheaders.com.
- [ ] Restauration d'une sauvegarde testée avec succès.
- [ ] Recette SPEC §9 verte en préproduction.
- [ ] `docs/PROGRESS.md` mis à jour.
