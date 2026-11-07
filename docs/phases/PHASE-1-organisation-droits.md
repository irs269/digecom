# Phase 1 – Organisation, utilisateurs, droits, audit et paramètres

> Prérequis : phase 0 terminée. Relis `CLAUDE.md`, `docs/PERMISSIONS.md` (en entier), `docs/SPEC.md` §2, §3.1, §3.2 (hiérarchie), §6 modules 15 et 16, `docs/DATA-MODEL.md` (Organisation, Setting, AuditLog) et `docs/PROGRESS.md`.

## Objectif

L'administrateur gère les îles, les sites, les comptes, les rôles, les rattachements (île, site, leader) et les paramètres versionnés. Le contrôle d'accès **par périmètre** est en place et testé pour tous les rôles. C'est la fondation de toutes les phases suivantes.

Commence par un plan court, puis implémente.

## À réaliser

### API
- `ScopeService` : à partir de l'utilisateur courant, construit les filtres Prisma (île, site, leader, propriétaire) selon les règles de `PERMISSIONS.md` ; utilisé par tous les services de lecture. Hors périmètre → 404.
- Îles / sites : CRUD sites (admin), désactivation au lieu de suppression.
- Utilisateurs (`users:*`, admin) :
  - liste paginée avec filtres rôle, île, site, leader, statut, recherche nom/téléphone ;
  - création (nom, téléphone +269, e-mail facultatif, rôle, île, site, leader pour SELLER/TCI), mot de passe temporaire + obligation de le changer à la première connexion ;
  - validations : un SELLER doit avoir un LEADER_SENIOR, un TELECONSULTANT un LEADER_JUNIOR, de la même île ; un rôle d'île doit avoir une île ;
  - modification, désactivation/réactivation (révoque les refresh tokens), réinitialisation du mot de passe ;
  - réaffectation d'un vendeur à un autre leader → `TeamAssignmentHistory` + audit.
- Équipes : `GET /leaders/:id/team`.
- Matrice : `GET /permissions/matrix` (pour l'écran).
- Journal : `GET /audit` (filtres acteur, entité, action, période), lecture seule, admin.
- Paramètres : `GET /settings` (valeurs en vigueur + historique), `POST /settings/:key` (nouvelle version avec `effectiveFrom` ≥ aujourd'hui) ; validation par clé (ex. `tci.bonusMin` ≤ `tci.bonusMax`, montants ≥ 0). Service `SettingsService.get(key, atDate)` utilisé partout ensuite.
- Changement de mot de passe par l'utilisateur.

### Web
- Module **Utilisateurs et droits** (admin) :
  - onglet Comptes : tableau (nom, rôle, périmètre, dernière connexion, statut), formulaire en panneau latéral, actions ;
  - onglet Matrice des droits : tableau modules × rôles avec badges Complet (vert) / Lecture (bleu) / —, identique au prototype ;
  - onglet Équipes : leaders Senior et Junior avec leurs membres, réaffectation ;
  - onglet Journal d'activité.
- Module **Paramètres** : formulaire groupé (Taxes, Abonnement, Règlements, Primes TCI, Livraisons, Stock) avec date d'effet, historique de chaque clé ; lecture seule pour FINANCE_MANAGER.
- Écran de changement de mot de passe obligatoire.

### Tests
- Unitaires `ScopeService` pour chaque rôle.
- E2E : chaque endpoint de la phase testé avec au moins un rôle autorisé et un rôle refusé ; création d'un SELLER sans leader → 422 ; TCI rattaché à un Leader Senior → 422 ; paramètre avec date passée → 422 ; lecture d'un paramètre à une date donnée renvoie la bonne version.
- Playwright : l'admin crée un e-commerçant rattaché à Ali Mohamed, le réaffecte, et retrouve l'historique ; un comptable ne voit pas le module Utilisateurs.

## Critères d'acceptation
- [ ] La matrice affichée et la matrice appliquée par l'API sont générées depuis le même fichier.
- [ ] Un utilisateur désactivé ne peut plus se connecter ni rafraîchir son token.
- [ ] Les paramètres sont versionnés et jamais écrasés.
- [ ] Toute action de la phase est dans le journal.
- [ ] `docs/PROGRESS.md` mis à jour.
