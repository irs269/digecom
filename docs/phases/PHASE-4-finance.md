# Phase 4 – Finance : calculs, écritures, abonnements, règlements, caisse, dépenses

> Prérequis : phase 3 terminée. Relis `CLAUDE.md` (règles 1 à 5, 10), `docs/SPEC.md` §4 en entier, §6 modules 11 à 13, `docs/DATA-MODEL.md` (Finance), `docs/PERMISSIONS.md` (`settlements`, `cash`, `expenses`) et `docs/OPEN-QUESTIONS.md` (#2, #9, #11 à #14).

## Objectif

Chaque vente produit automatiquement ses écritures financières exactes ; les abonnements sont prélevés ; les relevés de 14 jours passent par le circuit vérifier → valider → payer avec séparation des tâches ; la caisse et les dépenses sont tenues ; le résultat net est calculé. **Le test de référence doit tomber juste au KMF près.**

Commence par écrire les tests des calculs (TDD), puis le plan, puis l'implémentation.

## À réaliser

### Calculs (dans `packages/shared/finance.ts`, fonctions pures)
- `computeSale({ price, sellerShare, unitCost, digecomTax, sellerTax })` → part Dig'eCom, marge brute, marge après taxe, net vendeur (SPEC §4.1). Part vendeur fixe ou en pourcentage (arrondi à l'unité, règle d'arrondi documentée).
- `computeTciSale({ price, tciBonus, unitCost })` → CA, prime, coût ; partage Dig'eCom / Leader Junior **non calculé** (paramètre `leader.share`, hypothèse #2/#7).
- `computeSettlement(entries, subscriptions, carriedOver)` → lignes et net.
- Tests : exemple de référence exact ; simulation 100 produits exacte ; règlement 10 ventes → 50 000 ; part en pourcentage ; solde négatif reporté.

### Écritures (`LedgerService`)
- Au passage d'une commande en `SOLD`, dans la même transaction : `SALE_REVENUE`, `COGS` (coût FIFO figé en phase 3), `DIGECOM_TAX`, `SELLER_TAX`, `SELLER_COMMISSION` (ou `TCI_BONUS`), `COURIER_FEE` si livraison.
- Retour après vente : écritures inverses liées (`reversalOfId`) + justification ; jamais d'UPDATE/DELETE (contrainte : rôle PostgreSQL de l'application sans droits UPDATE/DELETE sur `LedgerEntry` et `AuditLog`, ou trigger qui refuse).
- Réception d'un lot : `SUPPLIER_PAYMENT` (une seule fois).

### Abonnements
- Job hebdomadaire (lundi 00:00 Indian/Comoro) : écriture `SUBSCRIPTION` de `subscription.weekly` pour chaque e-commerçant actif ; idempotent (relancer le job ne double pas).

### Règlements
- Job à la fin de chaque cycle (`settlement.anchorDate` + n × 14 jours) : génère un `Settlement` `GENERATED` par vendeur (ventes `SOLD` de la période, taxes, 2 abonnements, autres retenues, report du cycle précédent). Idempotent.
- `verify` (ACCOUNTANT), `approve` (FINANCE_MANAGER, pas la même personne que le vérificateur), `pay` (CASHIER de l'île du vendeur : moyen de paiement, référence, preuve) → `SETTLEMENT_PAYMENT` + opération de caisse `OUT`. ADMIN peut tout faire mais chaque étape reste tracée séparément.
- Relevé PDF téléchargeable (en-tête Dig'eCom, détail, net).

### Caisse
- Une caisse par site ; session ouverte avec montant d'ouverture ; opérations `IN` (vente comptoir, remise d'argent par un livreur avec choix des commandes concernées, abonnement payé en espèces) et `OUT` (règlement, dépense payée) ; clôture avec montant compté, calcul de l'écart ; alerte si écart ≠ 0. Solde bancaire saisi à partir des relevés.

### Dépenses
- Saisie (catégorie, libellé, montant, île, période, justificatif, campagne/leader facultatifs) → `PENDING` ; validation par FINANCE_MANAGER (pas sa propre saisie) → `EXPENSE`. Modification interdite après validation : correction par une nouvelle écriture.
- Résultat net par période et par île : marge après coût et taxes − charges validées.

### Web
- **Règlements** comme le prototype : bandeau du circuit, cycle courant, tableau (vendeur, île, ventes, net, statut), relevé individuel à droite, seul le bouton de l'étape du rôle connecté visible, message d'attente sinon.
- **Caisse** : cartes par site + solde bancaire, mouvements du jour, encaissement, remise livreur, clôture.
- **Dépenses** : KPI (marge, charges validées, résultat net, en attente), tableau avec bouton « Valider » pour le responsable financier.
- Encart « Calcul d'une vente de référence » sur le tableau de bord de la direction (valeurs réelles d'une vente sélectionnée).

### Tests
- Unitaires des calculs (ci-dessus) ; une commande de 12 500 vendue produit exactement les écritures attendues ; un refus n'en produit aucune.
- Séparation des tâches : même utilisateur qui vérifie puis valide → 403.
- Idempotence des jobs d'abonnement et de règlement.
- Tentative d'UPDATE SQL sur `LedgerEntry` → échec.
- Playwright : parcours comptable → financier → caissier sur le relevé de Fatima Said (10 ventes → 50 000 KMF).

## Critères d'acceptation
- [ ] Test de référence, simulation 100 produits et règlement de 50 000 exacts.
- [ ] Écritures immuables, corrections liées et justifiées.
- [ ] Circuit de règlement avec séparation des tâches.
- [ ] Caisse : clôture avec écart calculé.
- [ ] `docs/PROGRESS.md` mis à jour.
