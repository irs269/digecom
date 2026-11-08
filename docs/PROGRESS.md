# Avancement

Mis à jour par Claude Code à la fin de chaque phase : ce qui est fait, ce qui reste, décisions prises, écarts avec la SPEC.

| Phase | Sujet | Statut | Date | Notes |
| --- | --- | --- | --- | --- |
| 0 | Socle, Docker, authentification | Terminée | 2026-11-07 | Voir détail ci-dessous |
| 1 | Organisation, utilisateurs, droits, paramètres | Terminée | 2026-11-08 | Voir détail ci-dessous |
| 2 | Catalogues leaders, stock, achats Chine | Terminée | 2026-11-09 | Voir détail ci-dessous |
| 3 | Commandes, livraisons par île, notifications | Terminée | 2026-11-10 | Voir détail ci-dessous |
| 4 | Finance, règlements, caisse, dépenses | Terminée | 2026-11-11 | Voir détail ci-dessous |
| 5 | Leaders Junior, campagnes, prospects, gains TCI | Terminée | 2026-11-12 | Voir détail ci-dessous |
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

## Phase 1 – Organisation, utilisateurs, droits, audit et paramètres

### Fait

- `ScopeService` (API) : filtres Prisma par périmètre (global avec filtre île facultatif, île, leader, propriétaire) pour les 12 rôles ; hors périmètre → 404. Utilisé par les comptes, les sites et les équipes ; prêt pour les phases suivantes (`filter(user, { island, leader, owner })`, `catalogLeaderId`).
- Îles / sites : `GET /islands`, `GET /sites` (limité à l'île pour les rôles d'île), création, modification, désactivation / réactivation (jamais de suppression).
- Comptes (`/users`, admin) : liste paginée et filtrée (rôle, île, site, leader, statut, recherche nom / téléphone), détail, création avec mot de passe temporaire, modification, désactivation (révoque les sessions), réactivation, réinitialisation du mot de passe (déverrouille), réaffectation à un leader (`TeamAssignmentHistory` + audit), historique par vendeur.
- Validations : SELLER → LEADER_SENIOR, TELECONSULTANT → LEADER_JUNIOR, même île ; rôles d'île et réseau → île obligatoire ; rôles globaux → aucune île ; site sur l'île de l'utilisateur ; un leader qui a une équipe ne change ni de rôle ni d'île ; l'admin ne change pas son propre rôle et ne se désactive pas.
- Équipes : `GET /leaders`, `GET /leaders/:id/team` (un leader : sa propre équipe uniquement), `GET /team-assignments`.
- `GET /permissions/matrix` et écran Matrice : générés depuis `packages/shared/src/permissions.ts`, la même source que les gardes de l'API.
- Journal : `GET /audit` (acteur, entité, action, période), actions nommées (`USER_CREATE`, `USER_REASSIGN`, `SETTING_VERSION`…) avec avant / après, mots de passe jamais journalisés.
- Paramètres : registre typé partagé (`packages/shared/src/settings.ts`), `GET /settings` (valeur en vigueur, versions prévues, historique), `GET /settings/:key?at=AAAA-MM-JJ`, `POST /settings/:key` (date d'effet ≥ aujourd'hui, validation par clé, prime TCI min ≤ max, une version par date, jamais d'écrasement) ; `SettingsService.get(key, date)` global.
- Mot de passe : `POST /auth/change-password` (politique 10 caractères, lettre + chiffre, autres sessions révoquées). Tant qu'un mot de passe temporaire n'est pas changé, l'API refuse tout sauf le profil et le changement (403 `PASSWORD_CHANGE_REQUIRED`) et le web redirige vers `/mot-de-passe`.
- Web : module Utilisateurs et droits (onglets Comptes avec panneau latéral, Matrice, Équipes avec réaffectation, Journal), module Paramètres (groupes, date d'effet, versions prévues, historique ; lecture seule pour le responsable financier), écran de changement de mot de passe.
- Seed : 24 comptes (réseau complet du prototype : 3 Leaders Senior, 2 Leaders Junior, 6 e-commerçants, 3 TCI, 3 livreurs) ; le seed ne modifie jamais un compte existant.

### Critères d'acceptation

- [x] La matrice affichée et la matrice appliquée par l'API sont générées depuis le même fichier.
- [x] Un utilisateur désactivé ne peut plus se connecter ni rafraîchir son token (test e2e).
- [x] Les paramètres sont versionnés et jamais écrasés (test e2e : 3 versions, conflit 409 sur une date déjà prise).
- [x] Toute action de la phase est dans le journal.
- [x] `docs/PROGRESS.md` mis à jour.

### Tests

- Vitest `shared` : 27 ; Jest unitaires API : 29 (dont `ScopeService` pour les 12 rôles) ; e2e API : 72 (chaque endpoint de la phase avec un rôle autorisé et un rôle refusé) ; Playwright : 8 parcours (dont création → réaffectation → historique, et comptable sans module Utilisateurs).

## Phase 2 – Catalogues des leaders, stock par site et achats en Chine

### Fait

- **StockService** (`apps/api/src/stock/stock.service.ts`) : seule porte d'entrée de `StockLevel`. Chaque opération verrouille la ligne (`SELECT … FOR UPDATE`), écrit ses `StockMovement` (append-only, trigger) et met à jour niveaux et lots dans la même transaction ; refus 409 de tout stock négatif. Opérations : entrée, réservation, libération, sortie FIFO (coût moyen pondéré renvoyé), retour dans les lots d'origine, casse, perte, ajustement, transfert (deux mouvements liés, lots enfants au même coût), écart d'inventaire. Jamais de lot à coût nul (`UNIT_COST_REQUIRED`).
- **Catalogues** : CRUD produits (leader : les siens, admin : tous ; autre leader → 404), part e-commerçant (Senior, fixe ou %) ou prime TCI (Junior, bornée par `tci.bonusMin` / `tci.bonusMax`), publier / retirer, prime −500 / +500, stock +/− avec motif sur un site de l'île du leader, photos (URL pré-signée MinIO → conversion WebP par sharp, 5 max, 5 Mo), `GET /catalog/visible` (vendeur : catalogue publié de SON leader avec stock de son île ; admin : `?asLeader=`).
- **Stock** : vue par site (disponible, réservé, coût rendu moyen des lots, valeur, alertes), KPI, historique des mouvements, lots, entrée manuelle, ajustement / casse / perte, transfert, inventaires (photo du théorique, comptage, clôture → `INVENTORY_DIFF` + alerte).
- **Alertes** : stock faible (seuil produit ou paramètre) et rupture en direct (y compris produits publiés jamais approvisionnés) ; invendus via un job BullMQ quotidien (06:00 heure des Comores) et `POST /stock/alerts/refresh` ; écarts d'inventaire.
- **Achats Chine** : fournisseurs, commandes fournisseurs (devise, taux en `Decimal`, conversion KMF, frais), statuts avec dates, réception (site de l'île de destination, quantité réellement reçue) → lot au numéro de la commande, coût réel, entrée en stock dans la même transaction ; montant et date de paiement conservés pour la phase 4.
- **Web** : Catalogues / Mon catalogue (tableau du prototype, actions, formulaire avec photos, « Ce que voit chaque équipe »), Stock (KPI, filtres, actions, inventaire, historique), Achats Chine (lots, étape suivante, commande fournisseur avec coût unitaire estimé, réception, frise des étapes).
- **Seed** : catalogues du prototype (Ali Mohamed, Nassur Ahmed, Moinaecha Ali, Rachad Ibrahim, Kamaria Said), 4 fournisseurs, lots LOT-014 (clôturé, 750 / unité) à LOT-017 ; stock créé via StockService.

### Critères d'acceptation

- [x] Aucun chemin de code ne modifie `StockLevel` hors `StockService` (test `stock-guard.spec.ts` qui parcourt les sources et le seed).
- [x] Mouvements de stock tous tracés (qui, quand, pourquoi) ; table append-only.
- [x] Coût de lot exact (250 + 500 → 750 ; 125 000 + 250 000 / 500 → 750) et FIFO correct (2×700 + 1×800).
- [x] Cloisonnement des catalogues prouvé par les tests (API et Playwright).
- [x] `docs/PROGRESS.md` mis à jour.

### Tests

- StockService contre PostgreSQL : 18 tests, dont **20 réservations simultanées sur un stock de 3 → exactement 3 réussissent** et opérations concurrentes sans stock négatif.
- e2e API phase 2 : 25 tests (catalogues, primes, photos, stock par île, inventaire, achats, réception). Total e2e API : 115.
- Playwright : 10 parcours (gestionnaire de stock d'Anjouan limité à Anjouan ; Ali publie un produit visible pour son équipe et pas pour celle de Nassur).

## Phase 3 – Commandes, livraisons par île et notifications

### Fait

- **Machine à états** (`packages/shared/src/orders.ts`) : 14 statuts, 17 actions avec statuts de départ, modes de remise, permission ou rôle propriétaire (vendeur, livreur affecté, offre en attente) et conditions (remises doubles). Utilisée par l'API (409 / 403) et par le web (boutons calculés). `statusAfterConfirmations` gère les doubles confirmations.
- **OrderService** : création (vendeur du catalogue de son leader, produit publié, stock de l'île, instantanés prix / part / taxes / prime TCI via `SettingsService`), transitions en une transaction avec mise à jour conditionnelle du statut, `OrderEvent` (append-only), audit, stock via `StockService` (réserve à la création, sortie FIFO au retrait du site avec coût figé, libération à l'annulation, retour ou casse au contrôle), notifications.
- **Livraisons** : passage à « prête » → `DeliveryOffer` pour les livreurs **actifs, disponibles, de l'île du site** ; acceptation « premier qui accepte » (mise à jour conditionnelle, offres des autres → `TAKEN_BY_OTHER`, retirées en temps réel) ; affectation manuelle (même île) ; job BullMQ différé « aucun livreur » ; frais de course figé à la remise (`delivery.feePerRun`).
- **API livreur** (`/courier/*`) : disponibilité, offres, courses, retrait, remise (montant encaissé obligatoire en livraison directe, photo de preuve par URL pré-signée), échec avec motif, client a pris / a refusé, historique et frais. **API vendeur** (`/me/orders`) : création, réception, client a pris / a refusé, annulation (avant confirmation).
- **Notifications** : table `Notification`, `NotificationService`, flux SSE `/notifications/stream` authentifié par le cookie de session et relayé par Redis pub/sub (plusieurs instances), liste / non lues / marquer comme lu, interface `PushProvider` (FCM en phase 8). Événements §7 : nouvelle commande, prête à livrer, prête au retrait, course acceptée / affectée, aucun livreur, remise, échec, client a pris / refusé, stock faible / rupture.
- **Web** : Commandes (tableau, panneau de détail avec frise ✓, boutons selon la machine à états et les droits, message lecture seule, « Nouvelle commande pour le compte de »), Livraisons (4 colonnes temps réel, affectation manuelle, livreurs de l'île), cloche de notifications, simulateur livreur / vendeur (admin, dev, jeton « au nom de » journalisé).

### Critères d'acceptation

- [x] Une commande à Mohéli ne notifie que les livreurs de Mohéli (test e2e : offres et notifications).
- [x] Stock toujours cohérent (réservé, sorti, retourné) après chaque scénario (vérifié à chaque étape ; lots restants = disponible + réservé).
- [x] Les trois modes de remise et leurs confirmations fonctionnent (e2e + Playwright).
- [x] Notifications en temps réel visibles dans le back-office (SSE vérifié à travers le proxy Next.js, cloche, toasts).
- [x] `docs/PROGRESS.md` mis à jour.

### Tests

- Machine à états : 34 tests (toutes les transitions valides, invalides par statut, mode, rôle, propriétaire).
- e2e API phase 3 : 23 tests (trois modes, échec, refus, annulation, casse, retour après vente, changement de mode, isolation par île, **10 acceptations simultanées → 1 seule**, alerte sans livreur avec horloge simulée, snapshots, SSE). Total e2e API : 138.
- Playwright : 11 parcours, dont logistique GC → commande pour Fatima Said → préparée → affectée → livrée par un livreur simulé ; la caisse de Mohéli n'y a pas accès.

## Phase 4 – Finance : calculs, écritures, abonnements, règlements, caisse, dépenses

### Fait

- **Calculs** (`packages/shared/src/finance.ts`, écrits en TDD) : `computeSale` (SPEC 4.1), `computeTciSale` (4.3, partage Leader Junior non calculé), `computeSettlement` (4.2, report des soldes négatifs), cycles de 14 jours et semaines lundi → dimanche. Arrondi documenté : pourcentages arrondis à l'unité (demi vers le haut), une fois par produit.
- **Grand livre** (`LedgerEntry`, append-only par trigger) : écritures de vente dans la transaction du passage en `SOLD` (CA, coût FIFO figé, taxes, commission ou prime TCI, frais de course) ; un refus n'en crée aucune ; retour après vente = écritures inverses liées (`reversalOfId`) et justifiées ; paiement fournisseur à la réception du lot (une seule fois, index unique).
- **Abonnements** : job hebdomadaire BullMQ (lundi 00:00 heure des Comores), idempotent (index unique bénéficiaire + semaine).
- **Règlements** : job quotidien de génération du dernier cycle terminé (idempotent), relevé = commissions − taxes − abonnements − retenues + report ; circuit vérifier (comptable) → valider (responsable financier, jamais le vérificateur, administrateur compris) → payer (caissier de l'île du vendeur) avec `SETTLEMENT_PAYMENT` et sortie de caisse en espèces ; relevé PDF (pdfkit).
- **Caisse** : une caisse par site, ouverture avec fond, encaissements (vente comptoir, remise d'un livreur avec choix des commandes, abonnement en espèces), décaissements (règlement, dépense validée), clôture avec écart calculé et alerte ; écritures `CASH_IN` / `CASH_OUT` ; solde bancaire.
- **Dépenses** : saisie → validation par le responsable financier (jamais sa propre saisie) → écriture `EXPENSE` ; annulation d'une dépense validée par écriture inverse justifiée ; **résultat net** par période et par île.
- **Web** : Règlements (bandeau du circuit, cycle, tableau, relevé à droite, seul le bouton de l'étape du rôle connecté, message d'attente, PDF), Caisse (cartes par site, solde bancaire, mouvements du jour, remise livreur, clôture avec écart), Dépenses (KPI marge / charges / résultat net / en attente, validation), encart « Calcul d'une vente de référence » sur le tableau de bord de la direction.
- **Seed** : caissière de Grande Comore (Halima Abdou, +269 330 00 25) ; 10 ventes de démonstration de Fatima Said au dernier cycle terminé + 2 abonnements → relevé de **50 000 KMF** « à vérifier ».

### Critères d'acceptation

- [x] Test de référence (12 500 → 3 750 / 7 000), simulation 100 produits et règlement de 50 000 exacts.
- [x] Écritures immuables (UPDATE / DELETE SQL refusés), corrections liées et justifiées.
- [x] Circuit de règlement avec séparation des tâches (même utilisateur vérifie puis valide → 403).
- [x] Caisse : clôture avec écart calculé et alerte.
- [x] `docs/PROGRESS.md` mis à jour.

### Tests

- Vitest `shared` : 72 (dont 11 calculs financiers).
- e2e API phase 4 : 19 (écritures exactes d'une vente à 12 500, frais de course, refus sans écriture, retour après vente, immuabilité, paiement fournisseur unique, abonnements et relevés idempotents, circuit et séparation des tâches, caisse, dépenses, résultat net, PDF). Total e2e API : 158.
- Playwright : 12 parcours, dont comptable → responsable financier → caissier sur le relevé de Fatima Said.

## Phase 5 – Leaders Junior, campagnes, prospects, ventes et gains des téléconseillers

### Fait

- **Campagnes** (`/campaigns`) : CRUD du Leader Junior (produit de son catalogue uniquement, autre leader → 404), canal, budget, dates, pause / relance, fin automatique à la date de fin (job BullMQ quotidien + contrôle à la lecture). Le budget crée une dépense `ADVERTISING` rattachée à la campagne et au leader, validée par la finance (phase 4) ; budget non modifiable une fois validé. Indicateurs : contacts, confirmées, vendues (`SOLD`), taux de confirmation, coût par vente.
- **Prospects** : import CSV / XLSX (exceljs) avec aperçu, téléphones normalisés +269, doublons (fichier et campagne), lignes invalides, rapport `ProspectImportBatch` (fichier conservé dans MinIO) ; saisie manuelle ; répartition manuelle ou équitable (round-robin en commençant par les TCI les moins chargés) avec notification ; TCI : injoignable (compteur, à rappeler), pas intéressé, note d'appel ; « Commande confirmée » crée la commande par le service de la phase 3 (`sellerType = TELECONSULTANT`, `campaignId`, `prospectId`, prime figée, stock du Leader Junior), dans la même transaction que le passage du prospect à « confirmé ».
- **Clôture et gains** : `POST /tci/sales/:id/close` (Vendu → `SOLD` + écriture `TCI_BONUS` ; Client a refusé → retour, aucune prime). `GET /tci/me/earnings?week=YYYY-Www` et `GET /tci/team/earnings` : montant vendu, produits vendus, gains de la semaine, gains globaux, ventes à clôturer, commandes de la semaine, gains par produit, tableau par TCI. Calcul **uniquement** depuis les instantanés `OrderItem.tciBonus` des commandes `SOLD` (semaine ISO lundi → dimanche, Indian/Comoro).
- **Web** : Campagnes (4 KPI, tableau, nouvelle campagne, pause / relance), Prospects (4 KPI, colonne TCI pour le leader, boutons d'appel, lien `tel:`, import avec aperçu et répartition), Mes ventes et gains / Ventes de l'équipe (sélecteur de semaine, 4 KPI, tableau par TCI, commandes à clôturer, gains par produit), cartes de tableau de bord Leader Junior et TCI.
- **Seed** : campagnes CP-06 (terminée) et CP-07 (active), prospects du prototype, commandes TCI du prototype datées par rapport à la semaine en cours et historique des primes (Anlia 54 000, Faïza 31 000, Bacar 18 000).

### Critères d'acceptation

- [x] Les gains du TCI se calculent seuls, par semaine et au total (Anlia : 47 500 vendus / 8 500 / 68 000, puis 11 500 après clôture).
- [x] Prime fixée par le Leader Junior, bornée (phase 2), figée sur chaque vente (test : prime modifiée après la vente).
- [x] Les commandes TCI suivent le même circuit de livraison et de stock que les autres.
- [x] `docs/PROGRESS.md` mis à jour.

### Tests

- Vitest `shared` : 77 (dont semaines ISO, CSV, rapport d'import, round-robin).
- e2e API phase 5 : 14 (gains du prototype et clôture, équipe, campagnes et dépense, import CSV / XLSX, doublons et invalides, répartition, isolement des TCI, scénario complet +3 000, refus sans prime, prime figée). Total e2e API : 172.
- Playwright : parcours Leader Junior (campagne, import, répartition) puis TCI (appel, confirmation, livraison, clôture, gains).

## Décisions prises

- 2026-11-07 – Images MinIO Chainguard (`chainguard/minio`, `chainguard/minio-client`) épinglées par digest – les images `minio/*` ne sont plus publiées sur Docker Hub.
- 2026-11-07 – Limitation de connexion maison dans Redis plutôt que `@nestjs/throttler` – compter par IP + téléphone et partager le compteur entre instances.
- 2026-11-07 – Les endpoints ouverts à tout utilisateur connecté (ex. `/auth/me`) portent `@AnyAuthenticated()` – garder le refus par défaut explicite.
- 2026-11-07 – `make.ps1` à côté du `Makefile` – postes Windows sans Make.
- 2026-11-07 – Volumes nommés pour `node_modules` et `.next` + service `deps` – éviter les binaires Windows et la lenteur du montage Windows.
- 2026-11-08 – `apps/api/dist` aussi en volume nommé (et `deleteOutDir: false`) – en CI Linux le conteneur ne peut pas écrire dans le dépôt monté.
- 2026-11-08 – Réaffectation d'un vendeur vers un leader d'une autre île : le vendeur suit l'île du nouveau leader (son site est retiré) – garder la règle « même île » sans bloquer les déménagements. Voir OPEN-QUESTIONS T7.
- 2026-11-08 – Sites, îles et réaffectations protégés par les permissions existantes (`users:write`, `network:reassign`) – pas de nouveau module dans la matrice.
- 2026-11-09 – Coût d'un lot calculé sur la quantité **réellement reçue** (pertes en route incluses dans le coût unitaire) – coût réel, jamais compté deux fois. Voir OPEN-QUESTIONS T11.
- 2026-11-09 – Reprise des données du prototype : le stock restant de LOT-014 est obtenu par un ajustement tracé « ventes antérieures à la plateforme ».
- 2026-11-09 – Images MinIO signées avec `S3_PUBLIC_ENDPOINT` (adresse vue par le navigateur), opérations internes via `S3_ENDPOINT`.
- 2026-11-12 – Import de contacts envoyé en base64 dans un JSON (8 Mo max) : pas de dépendance multipart, aperçu et import par le même endpoint (`dryRun`).
- 2026-11-12 – Les commandes TCI n'ont ni part vendeur ni taxe e-commerçant (prime seulement) ; la taxe Dig'eCom s'applique sur le prix moins la prime n'étant pas définie, elle porte sur le prix (hypothèse, voir OPEN-QUESTIONS T22).
- 2026-11-11 – Paiement d'un règlement : sortie de caisse uniquement en espèces ; Huri Money, MVola et virement ne touchent pas la caisse physique.
- 2026-11-11 – Les relevés ne concernent que les e-commerçants ; les gains des TCI (primes) sont suivis en phase 5.
- 2026-11-11 – Résultat net : les frais de course sont comptés comme charge (catégorie livraison).
- 2026-11-10 – Livraison échouée et refus passent immédiatement en « retour à contrôler » (deux événements dans la frise) – la marchandise revient au site dans les deux cas.
- 2026-11-10 – Casse au retour : retour en stock puis sortie `DAMAGED` liée à la commande – mouvements traçables et lots cohérents.
- 2026-11-10 – Simulateur : jeton d'accès 15 min « au nom de » un livreur ou un vendeur, admin uniquement, `DEV_TOOLS_ENABLED=true` et jamais en production.
- 2026-11-10 – SSE écrit à la main (pas `@Sse`) pour pouvoir répondre 401 sans session.
- 2026-11-08 – Playwright : préchauffage des pages et compteurs de connexion remis à zéro par `make e2e` – le mode dev compile chaque page à la première visite.

## Écarts et dettes techniques

(À traiter avant la mise en production)

- `StockMovement.orderId` sans clé étrangère vers `Order` (les tests du StockService utilisent des identifiants libres) : à ajouter en phase 7.
- Les écritures financières (ventes, coûts, taxes, frais de course) sont préparées (instantanés, coût FIFO, frais) mais créées en phase 4.
- Le job BullMQ des invendus tourne dans le processus API ; à isoler dans un worker dédié en phase 7 si la charge augmente.

- Mode dev sous Windows (sans impact sur Playwright, qui tourne sur une build de production via le service `web-e2e`) : première compilation d'une page Next.js lente (~15-40 s) à cause du montage de fichiers ; sans impact en production (image `prod` compilée).
- Rôle PostgreSQL applicatif sans droits UPDATE/DELETE sur `AuditLog` : protégé par trigger pour l'instant ; le rôle DB dédié sera créé en phase 7.
- Prisma 5 / NestJS 10 conformes au plan validé ; montée de version à évaluer en phase 7.
