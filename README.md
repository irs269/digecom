# Dig'eCom – Plateforme de gestion commerciale, logistique et financière

Monorepo pnpm : **API NestJS** (`apps/api`), **back-office Next.js** (`apps/web`), code partagé
(`packages/shared` : rôles, matrice des droits, calculs, schémas Zod) et configuration partagée
(`packages/config`). Tout tourne dans **Docker**.

Documentation fonctionnelle : [`docs/SPEC.md`](docs/SPEC.md) · droits : [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)
· modèle de données : [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) · avancement : [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Prérequis

- **Docker** (Docker Desktop sous Windows/macOS, Docker Engine + plugin Compose sous Linux).
- **Make** (Linux/macOS). Sous Windows sans Make, utilise **`./make.ps1`** à la place de `make`
  (mêmes cibles : `./make.ps1 up`, `./make.ps1 test`…).

Rien d'autre : Node.js, pnpm, PostgreSQL, Redis et MinIO tournent dans les conteneurs.

## Démarrage en 3 commandes

```bash
cp .env.example .env
make up
make migrate && make seed
```

Le premier `make up` prend quelques minutes (images et dépendances). Ensuite :

| Service       | URL                            |
| ------------- | ------------------------------ |
| Back-office   | http://localhost:3000          |
| API           | http://localhost:4000          |
| Swagger       | http://localhost:4000/api/docs |
| Santé         | http://localhost:4000/health   |
| Console MinIO | http://localhost:9001          |

Port déjà pris sur ta machine (autre projet Docker) ? Change `WEB_PORT`, `POSTGRES_PORT`… dans
`.env` (et `WEB_ORIGIN` si tu changes `WEB_PORT`), puis relance `make up`.

## Comptes de démonstration

Mot de passe commun en développement : **`Digecom2026!`** (variable `SEED_DEFAULT_PASSWORD`).
En production, `SEED_FORCE_PASSWORD_CHANGE=true` impose un changement à la première connexion.

| Rôle                   | Nom                | Téléphone      | Île / site                                | Modules |
| ---------------------- | ------------------ | -------------- | ----------------------------------------- | ------- |
| Administrateur général | Direction Dig'eCom | +269 330 00 01 | toutes                                    | 16      |
| Responsable financier  | Soifia Mohamed     | +269 330 00 02 | toutes                                    | 14      |
| Comptable              | Abdallah Saïd      | +269 330 00 03 | toutes                                    | 11      |
| Assistant comptable    | Hadidja Ahmed      | +269 330 00 04 | toutes                                    | 4       |
| Caissier               | Mariama Combo      | +269 330 00 05 | Mohéli · Fomboni – Boutique               | 3       |
| Gestionnaire de stock  | Nourdine Assoumani | +269 330 00 06 | Anjouan · Mutsamudu – Boutique            | 6       |
| Assistant logistique   | Toiwilou Hamada    | +269 330 00 07 | Grande Comore · Moroni – Entrepôt central | 5       |
| Leader Senior          | Ali Mohamed        | +269 330 00 08 | Grande Comore                             | 5       |
| Leader Junior          | Rachad Ibrahim     | +269 330 00 09 | Grande Comore                             | 7       |
| Téléconseiller (TCI)   | Anlia Hassani      | +269 330 00 10 | Grande Comore (équipe Rachad Ibrahim)     | 3       |
| E-commerçant           | Fatima Said        | +269 330 00 11 | Grande Comore (équipe Ali Mohamed)        | mobile  |
| Livreur                | Djamal Said        | +269 330 00 12 | Anjouan                                   | mobile  |

Sécurité de la connexion : 5 essais / 15 min par IP + téléphone, compte verrouillé 15 min après
5 échecs. Pour débloquer un compte en dev : `make reset` ou attendre 15 min.

## Commandes

| Commande                | Rôle                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `make up` / `make down` | Démarre / arrête la stack (les données restent)                                        |
| `make logs`             | Logs de tous les services                                                              |
| `make migrate`          | Migrations Prisma (`prisma migrate dev`)                                               |
| `make seed`             | Données de démonstration (idempotent)                                                  |
| `make test`             | Tests `shared` (Vitest) + API unitaires et e2e (Jest + Supertest, base `digecom_test`) |
| `make e2e`              | Parcours web Playwright (conteneur dédié)                                              |
| `make lint`             | ESLint + Prettier `--check` + `tsc --noEmit`                                           |
| `make psql`             | Console SQL                                                                            |
| `make build`            | Images de production (cible `prod` des Dockerfiles)                                    |
| `make reset`            | Supprime conteneurs **et volumes** (demande confirmation)                              |

`make test`, `make lint`, `make migrate` et `make seed` s'exécutent dans le conteneur `api` :
lance `make up` d'abord.

## Architecture

```
apps/
  api/        NestJS 10 · Prisma 5 · PostgreSQL 16 · Redis 7
    prisma/   schema.prisma, migrations/, seed
    src/      auth (JWT + refresh rotatif), audit, health, users, config (Zod), prisma, redis
    test/     e2e Jest + Supertest
  web/        Next.js 15 (App Router) · React 19 · Tailwind · TanStack Query · react-hook-form
    src/app   /connexion, (app)/tableau-de-bord, pages modules, 403
    e2e/      Playwright
packages/
  shared/     Role, ModuleKey, PERMISSIONS (source de vérité), formatKmf, schémas Zod
  config/     tsconfig, ESLint, Prettier partagés
docker/       scripts d'initialisation (base de test, dépendances)
compose.yml   postgres, redis, minio (+ minio-init), deps, api, web, e2e
```

### Droits d'accès

- La matrice vit dans `packages/shared/src/permissions.ts` ; un test vérifie qu'elle est
  identique à `docs/PERMISSIONS.md`.
- Côté API, deux gardes globales : `JwtAuthGuard` puis `PermissionsGuard`. Chaque endpoint déclare
  `@RequirePermission('module:read' | 'module:write' | 'module:action')`, `@AnyAuthenticated()`
  ou `@Public()`. **Sans déclaration, l'endpoint est refusé (403).**
- Le menu du back-office est construit à partir de `GET /auth/me` (modules autorisés).

### Authentification

- `POST /auth/login` (téléphone + mot de passe, argon2id) → jeton d'accès JWT 15 min (gardé en
  mémoire côté web) + refresh token rotatif en cookie `httpOnly; Secure; SameSite=Lax`, stocké
  hashé en base et révocable. La réutilisation d'un refresh token déjà tourné révoque toutes les
  sessions de l'utilisateur.
- `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.

### Journal d'audit

Toute requête mutante authentifiée réussie et toute connexion (réussie ou non) écrivent dans
`AuditLog`. La table est **append-only** : un trigger PostgreSQL refuse UPDATE et DELETE.
Consultation : `GET /audit-logs` (administrateur).

### Erreurs

Format unique `{ code, message, details }` ; codes HTTP 400, 401, 403, 404, 409, 422, 429.
Logs JSON (pino) avec `X-Request-Id`.

## Règles du projet

Voir [`CLAUDE.md`](CLAUDE.md) : argent en entiers KMF, écritures financières immuables,
instantanés sur les commandes, cloisonnement par île et par leader, contrôle d'accès côté serveur.
