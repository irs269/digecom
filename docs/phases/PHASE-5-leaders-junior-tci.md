# Phase 5 – Leaders Junior, campagnes, prospects, ventes et gains des téléconseillers

> Prérequis : phase 4 terminée. Relis `CLAUDE.md`, `docs/SPEC.md` §3.3, §4.3, §5.4, §6 modules 8 à 10, `docs/DATA-MODEL.md` (Leaders Junior), `docs/PERMISSIONS.md` (`campaigns`, `prospects`, `tci_sales`) et `docs/OPEN-QUESTIONS.md` (#5 à #7, #15). Ouvre le prototype web et joue les profils « Leader Junior » et « Téléconseiller ».

## Objectif

Le Leader Junior publie ses produits avec une prime par produit (déjà possible en phase 2), lance une campagne, importe les contacts reçus et les répartit ; le TCI appelle ses prospects, confirme des commandes qui suivent le circuit normal, **clôture la vente après livraison**, et voit automatiquement son montant vendu et ses gains de la semaine et globaux.

Commence par un plan, puis implémente.

## À réaliser

### Campagnes
- CRUD pour LEADER_JUNIOR (les siennes) : nom, produit de **son** catalogue, canal, budget, dates, statut (active, pause, terminée automatiquement à la date de fin par un job).
- Le budget crée une dépense `ADVERTISING` rattachée à la campagne et au leader (passe par la validation des dépenses de la phase 4).
- Indicateurs calculés : contacts, confirmées, vendues (`SOLD`), taux de confirmation, coût par vente = budget ÷ ventes (« — » si 0).

### Prospects
- Import CSV / XLSX (colonnes nom, téléphone, note) avec aperçu, normalisation du téléphone (+269), détection des doublons (même téléphone dans la même campagne), rapport d'import (`ProspectImportBatch`). Saisie manuelle aussi.
- Répartition entre les TCI de l'équipe : manuelle ou automatique équitable (round-robin sur les TCI actifs).
- TCI : liste de **ses** prospects (filtre statut), actions « Commande confirmée », « Injoignable » (compteur de tentatives, reste à rappeler), « Pas intéressé » ; note d'appel.
- « Commande confirmée » ouvre un formulaire pré-rempli (client, téléphone, produit de la campagne, adresse, zone, quantité, mode de remise = livraison au client par défaut) et crée la commande via le service de la phase 3 avec `sellerType = TELECONSULTANT`, `campaignId`, `prospectId`, snapshot `tciBonus`. Stock du Leader Junior vérifié.
- Notification au TCI à chaque prospect attribué.

### Clôture et gains
- Après `HANDED_OVER`, le TCI (ou admin) clôture : « Vendu » → `SOLD` (écritures `TCI_BONUS` de la phase 4) ou « Client a refusé » (motif) → retour, aucune prime.
- Endpoints : `GET /tci/me/earnings?week=YYYY-Www` et `GET /tci/team/earnings?week=` (Leader Junior) : montant vendu, nombre de produits vendus, gains de la semaine, gains globaux (depuis le début), ventes livrées à clôturer, détail par produit (n × prime, prime fixée par tel leader), tableau par TCI. Semaine lundi → dimanche, Indian/Comoro. Calcul **uniquement** depuis les snapshots des commandes `SOLD`.
- Changer la prime d'un produit n'affecte pas les ventes déjà créées (test).

### Web
- **Campagnes** comme le prototype : 4 KPI (budget, contacts + taux, ventes, coût par vente), tableau, « + Nouvelle campagne », Pause / Relancer.
- **Prospects** : 4 KPI (à appeler, confirmées, ventes, primes), tableau avec colonne TCI pour le Leader Junior, boutons d'appel pour le TCI, bouton « Importer des contacts » pour le Leader Junior, lien `tel:` sur le numéro.
- **Mes ventes et gains** (TCI) / **Ventes de l'équipe** (Leader Junior) : sélecteur de semaine, 4 KPI (montant vendu, gains de la semaine, gains globaux, à clôturer), tableau par TCI (Leader Junior), commandes de la semaine avec boutons « Vendu » / « Client a refusé », « Gains par produit ».
- Tableaux de bord Leader Junior et TCI comme le prototype.

### Tests
- Import : doublons, numéros invalides, rapport exact.
- Un TCI ne voit ni ne modifie les prospects d'un autre (404).
- Scénario complet : prospect → commande → livraison → clôture « Vendu » → gains +3 000 ; refus → 0.
- Gains : seed du prototype (Anlia Hassani) → semaine en cours 47 500 vendus / 8 500 de gains / 68 000 globaux, puis 11 500 après clôture de la commande en attente.
- Prime modifiée après une vente → la vente garde l'ancienne prime.
- Playwright : parcours Leader Junior (campagne, import, répartition) puis TCI (appel, confirmation, clôture, gains).

## Critères d'acceptation
- [ ] Les gains du TCI se calculent seuls, par semaine et au total, sans saisie manuelle.
- [ ] Prime fixée par le Leader Junior, bornée, figée sur chaque vente.
- [ ] Les commandes TCI suivent le même circuit de livraison et de stock que les autres.
- [ ] `docs/PROGRESS.md` mis à jour.
