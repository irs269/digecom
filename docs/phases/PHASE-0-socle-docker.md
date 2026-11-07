# Phase 0 – Socle technique, Docker et authentification

> Prompt à coller dans Claude Code. Relis d'abord `CLAUDE.md`, `docs/SPEC.md` (sections 1, 2, 8), `docs/PERMISSIONS.md` (rôles), `docs/DATA-MODEL.md` (User, RefreshToken, AuditLog) et ouvre `docs/prototype/web/index.html` pour la charte.

## Objectif

Mettre en place le monorepo, l'environnement **entièrement dockerisé**, l'authentification, la mise en page du back-office aux couleurs Dig'eCom et la chaîne de qualité. À la fin, `make up` puis `http://localhost:3000` affiche l'écran de connexion Dig'eCom, et un administrateur seedé peut se connecter et voir un tableau de bord vide.

**Avant d'écrire du code, propose un plan (arborescence, services Docker, versions, scripts) et attends ma validation.**

## À réaliser

### 1. Monorepo
- pnpm workspaces : `apps/api`, `apps/web`, `packages/shared`, `packages/config` (eslint, tsconfig, prettier partagés).
- TypeScript strict, ESLint, Prettier, Husky + lint-staged (lint et typecheck avant commit).
- `packages/shared` exporte : enum `Role`, type `ModuleKey`, la matrice `PERMISSIONS` complète de `docs/PERMISSIONS.md` (même si les modules arrivent plus tard), un utilitaire `formatKmf(12500) → "12 500 KMF"`, les schémas Zod communs.

### 2. Docker (développement)
`compose.yml` avec :
- `postgres` (16-alpine, volume nommé, healthcheck `pg_isready`), base `digecom` + base `digecom_test`.
- `redis` (7-alpine, healthcheck).
- `minio` (+ service `minio-init` qui crée les buckets `products`, `proofs`, `documents`).
- `api` : image Node 22, montage du code, `pnpm --filter api start:dev`, dépend de postgres/redis healthy, port 4000.
- `web` : Next.js en dev, port 3000, appelle l'API via `NEXT_PUBLIC_API_URL` et un rewrite `/api` → `api:4000`.
- `.env.example` complet et commenté ; aucune valeur secrète en dur.
- `Makefile` : `up`, `down`, `logs`, `migrate`, `seed`, `test`, `e2e`, `lint`, `psql`, `reset` (supprime volumes après confirmation).
- Les `Dockerfile` de `api` et `web` sont **multi-stage** dès maintenant (cible `dev` et cible `prod`), utilisateur non-root.

### 3. API NestJS
- Modules : `prisma`, `config` (validation des variables d'env au démarrage avec Zod), `auth`, `users` (lecture de soi), `audit`, `health`.
- Prisma : modèles `Island`, `Site`, `User`, `RefreshToken`, `AuditLog`, `Setting` de `DATA-MODEL.md`. Migration initiale.
- Auth :
  - `POST /auth/login` (téléphone + mot de passe), argon2id, rate limiting (5 essais / 15 min / IP+téléphone), verrouillage 15 min après 5 échecs.
  - JWT d'accès 15 min (en mémoire côté web), refresh token rotatif en cookie `httpOnly; Secure; SameSite=Lax`, stocké hashé, révocable.
  - `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` (profil + rôle + île + liste des modules autorisés calculée depuis `PERMISSIONS`).
  - Garde globale `JwtAuthGuard` + décorateur `@RequirePermission('module:action')` + `PermissionsGuard` (lit la matrice partagée). Les endpoints sans décorateur sont refusés par défaut (sauf `@Public()`).
- Interceptor d'audit : toute requête mutante authentifiée écrit dans `AuditLog` (action, entité, id, avant/après quand disponible). Connexions réussies et échouées journalisées.
- Format d'erreur unique `{ code, message, details }`, filtre d'exception global, logs JSON (pino) avec `requestId`.
- Swagger sur `/api/docs` (désactivé en prod sauf variable).
- `GET /health` (DB + Redis).

### 4. Seed
- Les 3 îles ; sites : « Moroni – Entrepôt central » (GC), « Mutsamudu – Boutique » (AN), « Fomboni – Boutique » (MO).
- Un compte par rôle avec les noms du prototype (Direction Dig'eCom, Soifia Mohamed, Abdallah Saïd, Hadidja Ahmed, Mariama Combo (MO), Nourdine Assoumani (AN), Toiwilou Hamada (GC), Ali Mohamed (Leader Senior GC), Rachad Ibrahim (Leader Junior GC), Anlia Hassani (TCI GC), Fatima Said (e-commerçant GC), Djamal Said (livreur AN)…). Mot de passe de dev unique documenté dans le README, changé à la première connexion en prod.
- Paramètres par défaut de `DATA-MODEL.md` (clés `Setting`).

### 5. Web Next.js
- Thème Tailwind avec les couleurs et la police Poppins de `CLAUDE.md` ; composants de base shadcn/ui restylés (Button, Input, Table, Badge de statut 4 couleurs, Card KPI, Dialog, Toast).
- Page `/connexion` reprenant l'écran du prototype (fond bleu, cercle orange, logo, formulaire téléphone + mot de passe).
- Layout authentifié : menu bleu à gauche construit **depuis `/auth/me`** (seuls les modules autorisés, badge « LECTURE » pour les modules en lecture), carte « Connecté en tant que », bouton déconnexion ; en-tête avec titre de page, sous-titre, filtre île (rôles globaux) ou périmètre affiché (rôles d'île) ; zone de toasts.
- Gestion du token : refresh silencieux, redirection vers `/connexion` si expiré.
- Page tableau de bord vide (« bientôt ») et page 403 « Ce module n'est pas accessible à ton profil ».
- Responsive : le menu passe au-dessus du contenu sous 900 px.

### 6. Qualité
- Tests : unitaires `formatKmf` et `PERMISSIONS` (cohérence avec `PERMISSIONS.md`), e2e API auth (connexion OK, mauvais mot de passe, verrouillage, refresh, logout, route protégée 401, module interdit 403), Playwright : connexion admin → menu avec 16 entrées ; connexion caissier → 3 entrées.
- `make lint` et `make test` passent dans Docker.
- GitHub Actions (ou script CI local) : install, lint, typecheck, tests avec services postgres/redis.
- `README.md` : prérequis (Docker, Make), démarrage en 3 commandes, comptes de démo.
- Crée `docs/PROGRESS.md` à partir du modèle et coche la phase 0.

## Critères d'acceptation
- [ ] `git clone` + `cp .env.example .env` + `make up && make migrate && make seed` fonctionnent sur une machine vierge avec seulement Docker.
- [ ] Connexion de chaque compte seedé ; le menu correspond exactement à la matrice.
- [ ] Un endpoint protégé appelé sans droit renvoie 403, sans token 401.
- [ ] Toutes les connexions et mutations apparaissent dans `AuditLog`.
- [ ] Tests et lint verts.

## À ne pas faire
- Pas de module métier (commandes, stock…) dans cette phase.
- Pas de `prisma db push`, pas de secrets commités, pas de `any` non justifié.
