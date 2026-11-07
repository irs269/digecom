# Avancement

Mis à jour par Claude Code à la fin de chaque phase : ce qui est fait, ce qui reste, décisions prises, écarts avec la SPEC.

| Phase | Sujet | Statut | Date | Notes |
| --- | --- | --- | --- | --- |
| 0 | Socle, Docker, authentification | Terminée | 2026-11-07 | Voir détail ci-dessous |
| 1 | Organisation, utilisateurs, droits, paramètres | À faire | | |
| 2 | Catalogues leaders, stock, achats Chine | À faire | | |
| 3 | Commandes, livraisons par île, notifications | À faire | | |
| 4 | Finance, règlements, caisse, dépenses | À faire | | |
| 5 | Leaders Junior, campagnes, prospects, gains TCI | À faire | | |
| 6 | Tableaux de bord, réseau, rapports et exports | À faire | | |
| 7 | Production Docker, sécurité, sauvegardes | À faire | | |
| 8 | Application mobile Android | À faire | | |

## Phase 0 – Socle, Docker, authentification

### Fait

- Monorepo pnpm : `apps/api`, `apps/web`, `packages/shared`, `packages/config` ; TypeScript strict, ESLint, Prettier, Husky + lint-staged.
- `packages/shared` : `Role`, `ModuleKey`, matrice `PERMISSIONS` + `ACTIONS` complètes (vérifiées contre `PERMISSIONS.md` par un test qui lit le document), `allowedModules`, `formatKmf`, schémas Zod (téléphone, connexion, pagination).
- Docker : `compose.yml` (postgres 16 + base `digecom_test`, redis 7, minio + buckets `products`/`proofs`/`documents`, `deps`, api, web, e2e). Dockerfiles multi-stage `dev`/`prod`, utilisateur non-root. `Makefile` + `make.ps1` (Windows).
- API NestJS : modules `config` (Zod), `prisma`, `redis`, `auth`, `users` (lecture de soi), `audit`, `health`. Migration initiale `20261107000000_init` (Island, Site, User, RefreshToken, AuditLog, Setting) + trigger append-only sur `AuditLog`.
- Auth : argon2id, JWT 15 min, refresh rotatif en cookie httpOnly/Secure/SameSite=Lax stocké hashé (détection de réutilisation), limitation 5 essais / 15 min par IP + téléphone (Redis), verrouillage 15 min après 5 échecs. Gardes globales `JwtAuthGuard` + `PermissionsGuard`, refus par défaut.
- Audit : interceptor sur toutes les mutations authentifiées réussies, connexions réussies/échouées et déconnexions, champs sensibles masqués. `GET /audit-logs` (admin).
- Erreurs `{ code, message, details }`, logs pino JSON avec `X-Request-Id`, Swagger `/api/docs`, `GET /health`.
- Seed idempotent : 3 îles, 3 sites, 12 comptes (un par rôle, noms du prototype), 15 paramètres.
- Web : thème Dig'eCom (Poppins, couleurs), composants Button, Input/Field, Table, Badge 4 couleurs, Card KPI, Dialog, Toast ; `/connexion` ; layout avec menu depuis `/auth/me` (badge LECTURE), « Connecté en tant que », filtre île / périmètre ; refresh silencieux ; tableau de bord « bientôt » ; page 403 ; menu au-dessus du contenu sous 900 px.
- Qualité : Vitest (17 tests), Jest unitaires (5), e2e API (33), Playwright (6 parcours), CI GitHub Actions.

### Critères d'acceptation

- [x] `cp .env.example .env` + `make up && make migrate && make seed` fonctionnent avec seulement Docker.
- [x] Connexion de chaque compte seedé ; le menu correspond exactement à la matrice (test e2e API par rôle + Playwright admin 16 / caissier 3).
- [x] Endpoint protégé sans droit → 403, sans jeton → 401.
- [x] Connexions et mutations dans `AuditLog` (tests e2e).
- [x] Tests et lint verts dans Docker.

### Reste / à surveiller

- Le module `users` ne fait que la lecture de soi : la gestion des comptes arrive en phase 1.
- Le changement de mot de passe obligatoire (`mustChangePassword`) est stocké et exposé par `/auth/me`, mais l'écran de changement arrive en phase 1.
- `ScopeService` (périmètres île / leader / propriétaire) : à créer en phase 1 avec les premières listes.

## Décisions prises

- 2026-11-07 – Images MinIO Chainguard (`chainguard/minio`, `chainguard/minio-client`) épinglées par digest – les images `minio/*` ne sont plus publiées sur Docker Hub.
- 2026-11-07 – Limitation de connexion maison dans Redis plutôt que `@nestjs/throttler` – compter par IP + téléphone et partager le compteur entre instances.
- 2026-11-07 – Les endpoints ouverts à tout utilisateur connecté (ex. `/auth/me`) portent `@AnyAuthenticated()` – garder le refus par défaut explicite.
- 2026-11-07 – `make.ps1` à côté du `Makefile` – postes Windows sans Make.
- 2026-11-07 – Volumes nommés pour `node_modules` et `.next` + service `deps` – éviter les binaires Windows et la lenteur du montage Windows.

## Écarts et dettes techniques

(À traiter avant la mise en production)

- Mode dev sous Windows : première compilation d'une page Next.js lente (~15-40 s) à cause du montage de fichiers ; sans impact en production (image `prod` compilée).
- Rôle PostgreSQL applicatif sans droits UPDATE/DELETE sur `AuditLog` : protégé par trigger pour l'instant ; le rôle DB dédié sera créé en phase 7.
- Prisma 5 / NestJS 10 conformes au plan validé ; montée de version à évaluer en phase 7.
