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
| 6 | Tableaux de bord, réseau, rapports et exports | Terminée | 2026-11-13 | Voir détail ci-dessous |
| 7 | Production Docker, sécurité, sauvegardes | Prête à déployer | 2026-11-09 | Branche `deploy/phase-7-vps` ; déploiement sur le VPS à faire (docs/DEPLOY.md) |
| 8 | Application mobile Android | En cours | 2026-11-09 | Code et tests faits (branche `feat/phase-8-mobile`) ; push, APK, AAB et Play Store après le déploiement du web (docs/MOBILE.md) |

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

## Phase 8 – Application mobile Android (e-commerçants et livreurs)

Lancée avant le déploiement du web, à la demande. Le code tourne contre l'API locale ; tout ce qui demande l'API en ligne (push réel, APK de test, Play Store) attend la phase 7. Guide : docs/MOBILE.md.

### Fait

- **`apps/mobile`** : Expo SDK 58, Expo Router, TypeScript strict, TanStack Query avec cache persistant (24 h), react-hook-form + schémas Zod de `packages/shared`, thème du prototype (Poppins, bleu `#0B2FE0`, orange `#FFA500`), icône et écran de démarrage tirés du logo, package `km.digecom.app`.
- **Authentification** : même API ; en-tête `X-Client: mobile` → le refresh token circule dans le corps (gardé en SecureStore), pas en cookie ; rotation et détection de réutilisation inchangées. Session refusée (compte désactivé, révoqué) → déconnexion, cache et file vidés. Mot de passe provisoire à changer au premier lancement.
- **E-commerçant** : accueil (solde du cycle, à faire, statistiques), nouvelle vente (catalogue du leader seulement, produits en rupture non vendables, trois modes, « ce que tu gagnes » avec la taxe réelle du paramètre `tax.seller`), commandes (frise, reçu / récupéré, client a pris / refusé avec motif, annulation), solde (`GET /me/balance` : cycle en cours et relevés).
- **Livreur** : disponible / indisponible, offres de l'île (accepter / ignorer, retirées quand un autre accepte : push + rafraîchissement 15 s), course en cours (retrait, appel, remise avec montant encaissé et photo de preuve compressée 1280 px JPEG 70 %, client a pris / refusé, signaler un problème), historique, gains et argent à remettre à la caisse.
- **Push** : `POST/DELETE /me/devices` (table `Device`), `ExpoPushProvider` (service Expo → FCM, lots de 100, jetons périmés supprimés, un échec n'interrompt jamais l'action), canal Android `courses` (priorité max, son, vibration) pour `DELIVERY_OFFER` / `DELIVERY_ASSIGNED`. Désactivé par défaut (`PUSH_ENABLED`).
- **Hors ligne** : file d'actions sur le téléphone (AsyncStorage), rejouée dans l'ordre au retour du réseau ; `Idempotency-Key` fixée à la création de l'action ; intercepteur API (Redis, 24 h) qui renvoie la réponse déjà donnée sans refaire l'action ; une erreur libère la clé ; photo prise hors ligne envoyée juste avant l'action. Vente et acceptation d'une course exigent le réseau.
- **Appels Dig'eCom** (VoIP WebRTC, à la demande) : e-commerçant ↔ livreur d'une même commande, numéro masqué, chiffré, non enregistré ; table `Call` (journal : sonne, en cours, terminé, refusé, manqué, annulé, échec), sonnerie 45 s puis « manqué » + notification, un appel à la fois, relais des messages WebRTC par Redis, flux SSE mobile `/calls/stream` (appels et statuts en direct), push « appel entrant » sur un canal Android dédié, relais `coturn` (profil Compose `appels`, identifiants temporaires HMAC). Écran d'appel (décrocher, refuser, micro, haut-parleur, chrono), journal sur la commande, repli sur l'appel téléphonique (Expo Go, client final). **Étendu au back-office et à l'annuaire** : appels dans le navigateur (WebRTC), règle partagée `canCallDirectly` (admin ↔ tous, logistique ↔ livreurs et e-commerçants de son île, leaders ↔ leur équipe), `GET /calls/contacts` et `/calls/mine`, appels sans commande ; machine d'état d'appel partagée (`@digecom/shared`) entre web et mobile.
- **Publication préparée** : `eas.json` (development, preview APK, production AAB, signature gérée par EAS), fiche Play Store et politique de confidentialité (docs/store).

### Reste à faire

- Déployer le web et l'API (phase 7), puis remplacer `digecom.example.km` dans `apps/mobile/eas.json`.
- Firebase (`google-services.json`), clé FCM V1 dans EAS, `eas init` (projectId), `PUSH_ENABLED=true` en production ; mesurer le délai de notification sur téléphone réel.
- Construire l'APK `preview` et l'AAB `production`, jouer les parcours Maestro sur téléphone ou émulateur.
- Play Store : compte développeur, fiche, captures, URL de la politique de confidentialité, test fermé 12 testeurs × 14 jours, puis production.
- Appels Dig'eCom : premier essai réel entre deux téléphones (build natif + coturn sur le VPS), mesure de la qualité en 4G.
- Facultatif : écran « Mon catalogue » du Leader Senior.

### Critères d'acceptation

- [x] Un e-commerçant ne voit que le catalogue de son leader (`/catalog/visible` filtré côté API, tests e2e phase 2).
- [ ] Un livreur ne reçoit que les courses de son île, notification en moins de 10 s (filtrage par île testé en phase 3 ; délai du push à mesurer sur téléphone).
- [x] Les actions faites hors ligne sont rejouées sans doublon (tests Jest de la file + tests e2e `Idempotency-Key`).
- [ ] APK de test installable, AAB prêt pour le Play Store (configuration EAS prête, builds après le déploiement).
- [x] `docs/PROGRESS.md` mis à jour.

### Tests

- API e2e : `mobile.e2e-spec.ts` (8 tests : appareils, canal des offres, solde, `Idempotency-Key` rejoué / libéré / invalide) et refresh token mobile dans `auth.e2e-spec.ts`.
- Mobile (Jest) : 10 tests, dont action hors ligne envoyée une seule fois, réponse perdue puis renvoi avec la même clé (une seule exécution), ordre conservé, refus définitif signalé, photo envoyée une fois.
- Maestro (`apps/mobile/.maestro`) : vente → livraison → client a pris ; offre acceptée par un livreur et retirée chez l'autre (deux appareils). Écrits, **pas encore joués** (pas d'émulateur ni de build ici).
- API e2e `calls.e2e-spec.ts` (7 tests : droits, sonnerie, décroché, relais WebRTC, refus, annulation → manqué notifié, sonnerie expirée, un appel à la fois, journal et cloisonnement, identifiants TURN).
- Mobile : 7 tests de la machine d'état de l'appel. **Aucun appel réel testé** (WebRTC demande un build natif).
- `expo export --platform android` : bundle produit (3,6 Mo).

## Phase 7 – Mise en production sur le VPS (Docker, sécurité, sauvegardes)

Cible : VPS Contabo partagé (Ubuntu 24.04, Docker sans buildx), Nginx de l'hôte pour le HTTPS (Certbot), seuls 22/80/443 ouverts, ports 3000, 5432, 8069, 8071, 8080 et 8090 déjà pris. Branche `deploy/phase-7-vps`.

### Fait

- **`compose.prod.yml`** (le `compose.yml` de développement est inchangé) : cibles `prod` pour api et web, aucun code monté ; PostgreSQL, Redis (mot de passe) et MinIO sans port publié ; seuls `127.0.0.1:${WEB_PORT:-3100}` (web) et `127.0.0.1:${MINIO_PORT:-9100}` (API S3 de MinIO, console non publiée) ; `restart: unless-stopped`, healthchecks, limites mémoire (≈ 1,4 Go au total ; mesuré au repos : ≈ 260 Mo) ; buckets créés au démarrage ; ni base de test ni e2e.
- **Images** compatibles avec le builder classique (aucun `RUN --mount`), construites et vérifiées avec `DOCKER_BUILDKIT=0` : `prod` (api, sans CLI prisma ni tsx, 573 Mo), `migrate` (CLI prisma + tsx : `prisma migrate deploy` puis droits du rôle applicatif), web `standalone` (351 Mo).
- **Premier administrateur** : `docker compose -f compose.prod.yml run --rm migrate pnpm --filter api create-admin` (nom, téléphone, mot de passe masqué, politique de l'application) ; crée îles, sites et paramètres par défaut, aucun compte fictif. Seed de démonstration refusé si `NODE_ENV=production` (sauf `ALLOW_DEMO_SEED=oui-je-confirme`, préproduction).
- **`.env.production.example`** commenté (commande `openssl` pour chaque secret) ; l'API refuse de démarrer si un secret vaut `A-GENERER-…`, si Swagger ou les outils de dev sont actifs, si le cookie n'est pas `Secure` ou si `WEB_ORIGIN` n'est pas en HTTPS.
- **Derrière le proxy** : `TRUST_PROXY=2` (Nginx de l'hôte → Next.js → API) ; Nginx remplace `X-Forwarded-For` par `$remote_addr` (pas d'usurpation). Vérifié : 5 échecs depuis une IP → 429 pour cette IP seulement, l'audit enregistre l'IP réelle ; cookie `dc_rt` `HttpOnly; Secure; SameSite=Lax`, rafraîchissement OK.
- **MinIO derrière Nginx** : URL pré-signées signées pour `S3_PUBLIC_ENDPOINT`, en-tête `Host` conservé. Vérifié : PUT et GET 200 avec `Host` conservé, 403 sans (configuration Nginx exacte dans docs/DEPLOY.md, `client_max_body_size 12m`).
- **Sauvegardes** : `scripts/backup.sh` (cron de l'hôte) : `pg_dump` compressé + manifeste de comptages pris dans le même instantané + copie des buckets + `SHA256SUMS`, 14 jours gardés. `scripts/restore.sh` : test sur base temporaire (comptages = manifeste) ou `--production` (bascule de base, ancienne conservée, fichiers recopiés). Vérifié sur 60 commandes / 294 écritures : test et restauration de production réussis, fichier altéré refusé.
- **Dettes traitées** : clé étrangère `StockMovement.orderId` → `Order` ; rôle PostgreSQL applicatif sans UPDATE/DELETE sur `AuditLog` et les autres tables append-only (vérifié : circuit de commande complet, vente et retour après vente avec ce rôle) ; jobs gardés dans l'API (choix documenté).
- **Sécurité** : Next.js 15.5.29 / React 19.1.10 (4 vulnérabilités critiques de Next.js 15.3.1 corrigées) ; limitation de débit globale et par route sensible (Redis) ; corps JSON limité à 1 Mo (8 Mo pour l'import de contacts) ; `GET /ready` (base, migrations, Redis, S3) ; `GET /ops/metrics` (5xx, latence, jobs en échec) ; alerte in-app si un job échoue. CI : `pnpm audit --audit-level critical`, build classique des images et Trivy (vulnérabilités critiques).
- **Documentation** : docs/DEPLOY.md (pas à pas, blocs Nginx, Certbot, vérifications, mise à jour, sauvegarde et restauration), docs/EXPLOITATION.md, guides par rôle (docs/guides), recette SPEC §9 (`apps/web/e2e/recette`, `RECETTE=1`).

### Reste à faire

- Déployer sur le VPS en suivant docs/DEPLOY.md, puis cocher les critères ci-dessous.
- Captures d'écran des guides (`e2e/guides`, `GUIDES=1`) à générer.
- Recette SPEC §9 à jouer contre la préproduction.

### Critères d'acceptation

- [x] `docker compose -f compose.prod.yml config` valide ; images prod construites (builder classique) et démarrées : api `/health` et `/ready` OK, page `/connexion` 200.
- [x] Restauration d'une sauvegarde testée avec succès (base temporaire et production, en local).
- [ ] Déploiement reproductible sur le VPS en suivant docs/DEPLOY.md.
- [ ] HTTPS valide (Certbot) et en-têtes vérifiés sur le domaine réel.
- [ ] Recette SPEC §9 verte en préproduction.
- [x] `docs/PROGRESS.md` mis à jour.

## Phase 6 – Tableaux de bord par rôle, réseau commercial, rapports et exports

### Fait

- **Tableaux de bord** (`GET /dashboard`, filtre île pour les rôles globaux) : blocs propres à chaque rôle, comme le prototype. Direction / finance / comptabilité : CA du cycle, ventes, marge après coût et taxe, sommes dues aux vendeurs, taux de refus, livraisons sans livreur, à traiter, commandes récentes, meilleurs vendeurs, CA par île. Caissier, stock, logistique, Leader Senior (dont quantités restantes et classement), Leader Junior et TCI. Chaque chiffre est un lien vers la liste ou le rapport filtré. Agrégats SQL sur les instantanés `OrderItem` des commandes `SOLD`, index `Order(status, soldAt)` et `Order(leaderId, status, soldAt)`, cache Redis 60 s invalidé à chaque écriture d'un modèle suivi (middleware Prisma qui incrémente une version).
- **Réseau commercial** (`/reseau`) : équipes Senior et Junior, performances individuelles et collectives, comparaison des équipes, quantités attribuées par le Leader Senior à ses e-commerçants (`network:allocate`, journal `SellerAllocation` append-only, jamais sous les unités déjà commandées), objectif hebdomadaire de CA par équipe. Les réaffectations restent dans Utilisateurs (historisées depuis la phase 1).
- **Rapports** (`/rapports`, `GET /reports/:type`) : journalier, hebdomadaire, mensuel, par produit, lot, vendeur, leader, île, dépenses, marges, règlements, stocks, campagnes, gains TCI, livreurs, et « Simulation 100 produits » (tableau exact de la SPEC §4.1). Filtres période, île, site, leader ; un leader n'obtient que son équipe (autre équipe → 404, rapport global → 403). Un seul format (colonnes, lignes, totaux) pour l'écran, l'export XLSX (en-têtes en gras, montants `#,##0 "KMF"`, formules `SUM` avec résultat, onglet « Paramètres du rapport ») et le PDF (en-tête avec logo, tableau, totaux, pagination). Au-delà de 5 000 lignes : tâche BullMQ, fichier dans MinIO, lien notifié (`REPORT_READY`).
- **Notifications** : stock faible / rupture (déjà en place), relevé disponible (vendeur), abonnement de la semaine, vente TCI clôturée (TCI et Leader Junior), objectif atteint (une fois par semaine), export prêt. Préférences par utilisateur (`/preferences`, `PUT /notifications/preferences`) : l'in-app est toujours actif, le push (phase 8) peut être coupé par type, SMS et WhatsApp désactivés par défaut.
- **Charge** : `pnpm --filter api load-test` génère 50 000 commandes, mesure `GET /dashboard` sans cache pour 5 rôles, puis `-- --cleanup` les supprime. Mesuré : direction 192 ms, Leader Senior 161 ms, Leader Junior 302 ms, TCI 169 ms, logistique 47 ms (médianes). Le total des gains TCI est passé en agrégat SQL (il chargeait toutes les ventes : 1,35 s).
- **Seed** : quantités attribuées par Ali Mohamed à ses e-commerçants et objectifs hebdomadaires (Ali Mohamed, Rachad Ibrahim).

### Critères d'acceptation

- [x] 10 tableaux de bord conformes au prototype et à la SPEC (les 4 rôles globaux partagent la vue direction).
- [x] Tous les rapports exportables en Excel et PDF, chiffres identiques à l'écran (même calcul de totaux, test de relecture XLSX).
- [x] Tableau de bord < 800 ms sur 50 000 commandes de test (script fourni, pire médiane 302 ms).
- [x] `docs/PROGRESS.md` mis à jour.

### Tests

- Vitest `shared` : 81 (simulation, totaux, rapports par rôle, préférences).
- e2e API phase 6 : 13 (blocs comparés à une requête de référence, filtre île, 6 rôles, Leader Senior, invalidation du cache, simulation, concordance des 15 rapports, XLSX relu, PDF, périmètre leader 404 / 403, attribution, objectif, préférences). Total e2e API : 185.
- Playwright : direction (chiffre cliquable → rapport, totaux identiques, export Excel) et Leader Senior (son équipe, attribution, rapports de l'équipe).

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
- 2026-11-13 – Quantités attribuées = quota de vente par e-commerçant (journal append-only), pas une réservation physique du stock du site (voir OPEN-QUESTIONS T25).
- 2026-11-13 – Export des rapports ouvert aux leaders pour leur équipe (droit `reports:read` + périmètre), l'action `reports:export` restant réservée aux rôles globaux pour les rapports de toute la plateforme (T26).
- 2026-11-13 – Format Excel des montants `#,##0 "KMF"` : le séparateur de milliers suit la langue d'Excel (espace en français), plus lisible que le littéral `# ##0`.
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

- 2026-11-09 – Push via le service Expo (qui relaie vers FCM) plutôt que l'Admin SDK Firebase dans l'API – pas de clé Google sur le serveur, un seul appel HTTP, jetons périmés signalés par la réponse.
- 2026-11-09 – Refresh token du mobile dans le corps (en-tête `X-Client: mobile`) et en SecureStore – pas de cookie fiable dans une application native ; le web garde le cookie httpOnly.
- 2026-11-09 – Idempotence par en-tête `Idempotency-Key` (Redis, 24 h) sur les POST / PATCH authentifiés plutôt que par endpoint – toute action de terrain du mobile en profite sans code dédié.
- 2026-11-09 – Vente et acceptation de course exclues de la file hors ligne – le stock et « le premier qui accepte » doivent être vérifiés en direct.
- 2026-11-09 – L'app mobile passe par le back-office (`https://<domaine>/api`) – même chemin et même HTTPS que le web, aucun port de l'API exposé.

## Écarts et dettes techniques

(À traiter avant la mise en production)

- ~~`StockMovement.orderId` sans clé étrangère vers `Order`~~ : **traité en phase 7** (migration `20261114000000`, contrainte validée).
- Les écritures financières (ventes, coûts, taxes, frais de course) sont préparées (instantanés, coût FIFO, frais) mais créées en phase 4.
- Job BullMQ des invendus (et tous les jobs) : **gardés dans le processus API en phase 7** (`PROCESS_ROLE=all`, une seule instance, mémoire limitée sur le VPS). Un worker dédié est prêt (`dist/worker.js`, `PROCESS_ROLE=worker`) si la charge augmente ; voir docs/DEPLOY.md §13.

- Mode dev sous Windows (sans impact sur Playwright, qui tourne sur une build de production via le service `web-e2e`) : première compilation d'une page Next.js lente (~15-40 s) à cause du montage de fichiers ; sans impact en production (image `prod` compilée).
- ~~Rôle PostgreSQL applicatif sans droits UPDATE/DELETE sur `AuditLog`~~ : **traité en phase 7** (rôle `digecom_app` posé par `migrate` : sans DDL, sans UPDATE/DELETE/TRUNCATE sur `AuditLog`, `LedgerEntry`, `StockMovement`, `OrderEvent`, `SellerAllocation` ; les triggers restent en place).
- Prisma 5 / NestJS 10 conformes au plan validé ; montée de version reportée (aucune vulnérabilité critique : `pnpm audit --audit-level critical` vert après la mise à jour de Next.js).
