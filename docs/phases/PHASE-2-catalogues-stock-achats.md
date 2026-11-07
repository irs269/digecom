# Phase 2 – Catalogues des leaders, stock par site et achats en Chine

> Prérequis : phase 1 terminée. Relis `CLAUDE.md` (règles 1 à 4, 7, 12), `docs/SPEC.md` §3.2, §3.3, §4.4, §6 modules 4, 5, 7, `docs/DATA-MODEL.md` (Catalogue et stock), `docs/PERMISSIONS.md` (`catalog`, `stock`, `purchases`) et `docs/OPEN-QUESTIONS.md` (#1, #3, #4).

## Objectif

Chaque leader publie son propre catalogue avec son stock ; le stock est suivi par site avec des mouvements tracés ; les achats en Chine créent des lots avec leur coût réel. À la fin, on peut faire entrer un lot en stock et le voir disponible dans le catalogue du bon leader, et seulement chez lui.

Commence par un plan, puis implémente.

## À réaliser

### Service de stock (cœur, à faire en premier)
- `StockService` : seule porte d'entrée pour modifier `StockLevel`. Chaque opération crée un `StockMovement` et met à jour `StockLevel` **dans la même transaction** avec verrouillage de ligne. Refuse toute opération rendant `available` ou `reserved` négatif (409).
- Opérations : `entry(lot)`, `reserve(order)`, `release(order)`, `out(order)` (consomme les lots **FIFO**, renvoie le coût unitaire moyen pondéré de la sortie), `return`, `damaged`, `loss`, `adjust(reason)`, `transfer(from, to)` (deux mouvements liés), `inventory` (écarts → `INVENTORY_DIFF`).
- Tests unitaires exhaustifs, dont **concurrence** : 20 réservations simultanées sur un stock de 3 → exactement 3 réussissent.

### Catalogues
- CRUD `Product` pour LEADER_SENIOR / LEADER_JUNIOR (leurs produits uniquement), ADMIN (tous).
- Champs selon le type de leader : Senior → `sellerShareType` + `sellerShareValue` ; Junior → `tciBonus` borné par `tci.bonusMin` / `tci.bonusMax` (paramètres).
- Photos : upload direct vers MinIO via URL pré-signée, redimensionnement/compression WebP côté API (sharp), max 5 photos, 5 Mo.
- Publier / retirer ; un produit retiré n'est plus proposé aux vendeurs mais reste dans l'historique.
- `GET /catalog/visible` : ce qu'un vendeur voit = produits publiés de **son** leader avec stock disponible par site de son île ; utilisé par le TCI (phase 5) et le mobile (phase 8). Les admins peuvent appeler `?asLeader=` pour l'aperçu « ce que voit chaque équipe ».
- Changement de prix / part / prime : nouvelle valeur pour les ventes futures seulement (les commandes gardent leurs snapshots, phase 3).

### Achats Chine et lots
- Fournisseurs (CRUD), commandes fournisseurs avec devise, taux de change, montants, frais ; calcul du coût unitaire ; statuts de `DATA-MODEL.md` avec dates.
- Passage à `RECEIVED` : choix du site (île), quantité réellement reçue, création du `Lot` et `StockService.entry`. Écriture `SUPPLIER_PAYMENT` préparée pour la phase 4 (au minimum, garder le montant payé et la date).
- Rattachement du lot à un `Product` d'un leader (hypothèse #1).

### Web
- **Mon catalogue / Catalogues leaders** comme le prototype : tableau (leader + île + Senior/Junior, produit, qualité, prix, part vendeur ou prime TCI, stock, vendus, état Publié / Rupture / Retiré), actions Stock +/− avec motif, Publier/Retirer, Prime −500 / +500 (Junior, bornée) ; formulaire « Publier un produit » complet avec photos ; panneau « Ce que voit chaque équipe » (sélecteur d'équipe, produits visibles, nombre de produits masqués).
- **Stock** : KPI (valeur au coût rendu, unités, alertes), tableau par site (SKU, produit, leader, site, disponible, réservé, coût rendu, prix, alerte), filtres île/site/leader/alerte, actions Entrée, Transfert, Inventaire, Ajustement (avec motif obligatoire), historique des mouvements d'un produit.
- **Achats Chine** : liste des lots avec coût unitaire calculé, statut, bouton d'étape suivante ; formulaire de commande fournisseur ; écran de réception.
- Alertes : stock faible (seuil produit ou paramètre), rupture, invendu depuis `stock.unsoldDaysAlert` jours (job quotidien BullMQ), écart d'inventaire.

### Seed
Catalogues du prototype : Ali Mohamed (écouteurs Standard 12 500 / part 7 500 / stock 3, sac à main, ventilateur en rupture), Nassur Ahmed AN (écouteurs Premium 15 000 / 5, montre), Moinaecha Ali MO (lampe solaire, écouteurs retirés), Rachad Ibrahim Junior GC (montre Sport 17 000 / prime 3 000, blender 13 500 / prime 2 500), Kamaria Said Junior AN (lisseur 11 000 / prime 2 000) ; lots LOT-014 à LOT-017.

### Tests
- Lot : 250 + 500 de frais pour 1 unité → coût 750 ; 125 000 + 250 000 pour 500 unités → 750.
- FIFO : deux lots à 700 et 800, sortie de 3 unités sur 2 + 5 → coût 2×700 + 1×800.
- Un vendeur du leader 2 ne reçoit aucun produit du leader 1 via `/catalog/visible` (test API).
- Prime TCI hors bornes → 422 ; leader qui modifie le produit d'un autre → 404.
- Playwright : le gestionnaire de stock d'Anjouan ne voit que les sites d'Anjouan ; Ali Mohamed publie un produit, il apparaît dans l'aperçu de son équipe et pas dans celui de Nassur.

## Critères d'acceptation
- [ ] Aucun chemin de code ne modifie `StockLevel` hors `StockService`.
- [ ] Mouvements de stock tous tracés (qui, quand, pourquoi).
- [ ] Coût de lot exact et FIFO correct.
- [ ] Cloisonnement des catalogues prouvé par les tests.
- [ ] `docs/PROGRESS.md` mis à jour.
