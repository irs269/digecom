# Droits d'accès

Source de vérité dans le code : `packages/shared/src/permissions.ts`. Ce document et ce fichier doivent rester identiques. Chaque endpoint de l'API vérifie **le rôle** (module + action) **et le périmètre** (île, site, leader, propriétaire).

## Rôles (enum `Role`)

| Code | Libellé | App | Périmètre par défaut |
| --- | --- | --- | --- |
| `ADMIN` | Administrateur général | Web | Tout |
| `FINANCE_MANAGER` | Responsable financier | Web | Toutes les îles |
| `ACCOUNTANT` | Comptable | Web | Toutes les îles |
| `ACCOUNTANT_ASSISTANT` | Assistant comptable | Web | Toutes les îles |
| `CASHIER` | Caissier | Web | Son île (son site) |
| `STOCK_MANAGER` | Gestionnaire de stock | Web | Son île |
| `LOGISTICS_ASSISTANT` | Assistant logistique | Web | Son île |
| `LEADER_SENIOR` | Leader Senior | Web (+ mobile) | Son catalogue, son équipe d'e-commerçants |
| `LEADER_JUNIOR` | Leader Junior | Web | Son catalogue, ses campagnes, son équipe de TCI |
| `TELECONSULTANT` | Téléconseiller (TCI) | Web | Ses prospects, ses commandes, ses gains |
| `SELLER` | E-commerçant | Mobile (phase 8) | Catalogue de son leader, ses commandes, son solde |
| `COURIER` | Livreur | Mobile (phase 8) | Courses de son île qui lui sont proposées ou affectées |

## Matrice des modules du back-office

`C` = complet (consulter + agir selon actions ci-dessous), `L` = lecture seule, `—` = module invisible et endpoints refusés (403).

| Module (clé) | ADMIN | FINANCE | ACCOUNTANT | ACC_ASSIST | CASHIER | STOCK | LOGISTICS | LEADER_S | LEADER_J | TCI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tableau de bord `dashboard` | C | L | L | L | L | L | L | L | L | L |
| Commandes `orders` | C | L | L | — | — | L | C | L (équipe) | L (équipe) | — |
| Livraisons `deliveries` | C | L | — | — | — | L | C | — | — | — |
| Stock `stock` | C | L | L | — | — | C | L | — | — | — |
| Achats Chine `purchases` | C | L | L | — | — | C | — | — | — | — |
| Réseau commercial `network` | C | L | — | — | — | — | — | C (équipe) | — | — |
| Catalogues leaders `catalog` | C | L | L | — | — | L | L | C (le sien) | C (le sien) | — |
| Campagnes `campaigns` | C | L | L | — | — | — | — | — | C (les siennes) | — |
| Prospects `prospects` | C | — | — | — | — | — | — | — | L (équipe) + import/répartition | C (les siens) |
| Ventes et gains TCI `tci_sales` | C | L | L | — | — | — | — | — | L (équipe) | C (les siennes) |
| Règlements `settlements` | C | C (valider) | C (vérifier) | L | C (payer) | — | — | — | — | — |
| Caisse `cash` | C | L | L | C | C | — | — | — | — | — |
| Dépenses `expenses` | C | C (valider) | C (saisir) | C (saisir) | — | — | — | — | — | — |
| Rapports `reports` | C | C | C | — | — | — | — | L (équipe) | L (équipe) | — |
| Utilisateurs et droits `users` | C | — | — | — | — | — | — | — | — | — |
| Paramètres `settings` | C | L | — | — | — | — | — | — | — | — |

Libellés de menu selon le rôle : `catalog` → « Mon catalogue » pour un leader ; `tci_sales` → « Mes ventes et gains » pour un TCI, « Ventes de l'équipe » pour un Leader Junior.

## Actions fines (permission = `module:action`)

| Permission | Rôles autorisés | Règle de périmètre |
| --- | --- | --- |
| `orders:create_on_behalf` | ADMIN, LOGISTICS | vendeur de son île |
| `orders:advance` (confirmer, préparer, prête, remise site) | ADMIN, LOGISTICS | site de son île |
| `orders:change_mode` | ADMIN, LOGISTICS | tant que non sortie du site |
| `orders:mark_sold` / `orders:mark_refused` | ADMIN, LOGISTICS, SELLER (les siennes), COURIER (remise directe), TELECONSULTANT (les siennes, clôture) | propriétaire |
| `orders:restock_return` | ADMIN, STOCK | site de son île |
| `deliveries:assign_manual` | ADMIN, LOGISTICS | livreur de la même île |
| `deliveries:accept` / `pickup` / `handover` / `fail` | COURIER | courses proposées ou affectées, son île |
| `stock:entry` / `transfer` / `inventory` / `adjust` | ADMIN, STOCK | sites de son île |
| `purchases:create` / `advance` / `receive` | ADMIN, STOCK | destination dans son île |
| `catalog:publish` / `unpublish` / `edit_price` / `edit_share` / `adjust_stock` | ADMIN, LEADER_SENIOR, LEADER_JUNIOR | ses propres produits |
| `catalog:edit_tci_bonus` | ADMIN, LEADER_JUNIOR | ses produits, bornes 2 000–3 500 |
| `network:assign_seller` / `reassign` | ADMIN | — |
| `network:allocate` | ADMIN, LEADER_SENIOR | son équipe |
| `campaigns:create` / `pause` / `resume` / `edit` | ADMIN, LEADER_JUNIOR | ses campagnes |
| `prospects:import` / `assign` | ADMIN, LEADER_JUNIOR | ses campagnes, ses TCI |
| `prospects:call_outcome` (confirmé, injoignable, pas intéressé) | TELECONSULTANT | ses prospects |
| `tci_sales:close` | TELECONSULTANT, ADMIN | ses commandes au statut `HANDED_OVER` |
| `settlements:verify` | ACCOUNTANT, ADMIN | relevé `GENERATED` |
| `settlements:approve` | FINANCE_MANAGER, ADMIN | relevé `VERIFIED`, pas vérifié par lui-même |
| `settlements:pay` | CASHIER, ADMIN | relevé `APPROVED`, vendeur de son île |
| `cash:collect` / `cash:open` / `cash:close` | CASHIER, ACCOUNTANT_ASSISTANT, ADMIN | caisse de son site |
| `expenses:create` | ACCOUNTANT, ACCOUNTANT_ASSISTANT, ADMIN | — |
| `expenses:approve` | FINANCE_MANAGER, ADMIN | pas sa propre saisie |
| `reports:export` | ADMIN, FINANCE, ACCOUNTANT | leaders : rapports de leur équipe seulement |
| `users:*` | ADMIN | — |
| `settings:edit` | ADMIN | — |

## Règles de périmètre (à implémenter dans un service `ScopeService`)

- **Île** : CASHIER, STOCK, LOGISTICS, COURIER ne voient que les données dont `islandId` = leur île.
- **Leader** : LEADER_* ne voient que les produits `leaderId = moi`, les commandes `leaderId = moi`, leurs vendeurs.
- **Vendeur** : SELLER et TELECONSULTANT ne voient que leurs commandes, prospects, gains ; les produits et le stock de **leur** leader uniquement.
- **Global** : ADMIN, FINANCE, ACCOUNTANT, ACC_ASSIST voient toutes les îles avec un filtre île facultatif.
- Une donnée hors périmètre renvoie **404** (ne pas révéler son existence), un module interdit renvoie **403**.
- Tests obligatoires : pour chaque endpoint, un test « autorisé » et au moins un test « refusé » par rôle concerné.
