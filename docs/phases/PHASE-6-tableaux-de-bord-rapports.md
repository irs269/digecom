# Phase 6 – Tableaux de bord par rôle, réseau commercial, rapports et exports

> Prérequis : phase 5 terminée. Relis `docs/SPEC.md` §6 modules 1, 6, 14 et §7, `docs/PERMISSIONS.md` (`dashboard`, `network`, `reports`) et le prototype (tableau de bord de chaque profil).

## Objectif

Chaque rôle arrive sur un tableau de bord qui répond à « qu'est-ce que je dois faire maintenant et comment ça va ? », la direction pilote par île, et tous les rapports de la SPEC s'exportent en Excel et PDF avec des chiffres identiques à l'écran.

## À réaliser

### Tableaux de bord (endpoint `GET /dashboard` qui renvoie les blocs du rôle)
- **Direction / finance / comptabilité** : CA du cycle, ventes, marge après coût et taxe, sommes dues aux vendeurs, taux de refus, livraisons sans livreur ; à traiter (relevés à vérifier, règlements à valider, dépenses à valider, refus et échecs) ; commandes récentes ; meilleurs vendeurs ; CA par île (barres).
- **Caissier** : solde de caisse, encaissé du jour, règlements validés à payer, caisse à clôturer.
- **Stock** : valeur du stock, unités, alertes, lots en route, lots à réceptionner, retours à contrôler.
- **Logistique** : nouvelles commandes, sans livreur, en livraison, incidents.
- **Leader Senior** : ventes et CA de l'équipe, e-commerçants actifs, quantités restantes, classement de l'équipe.
- **Leader Junior** : budget pub, contacts, ventes, coût par vente, prospects à appeler.
- **TCI** : prospects à appeler, vendu cette semaine, gains de la semaine, gains globaux, ventes à clôturer.
- Chaque chiffre est cliquable vers la liste filtrée correspondante. Requêtes optimisées (index, agrégats SQL, cache Redis 60 s invalidé par événement).

### Réseau commercial
- Leaders et équipes (Senior et Junior), performances individuelles et collectives, comparaison entre équipes, attribution de quantités par le Leader Senior à ses e-commerçants (`network:allocate`), réaffectation (admin) avec historique.

### Rapports
- Journalier, hebdomadaire, mensuel, par produit, par lot, par vendeur, par leader, par île, dépenses, marges, règlements, stocks, campagnes, gains TCI, livreurs.
- Filtres communs : période, île, site, leader. Les leaders n'obtiennent que leur équipe.
- Export **XLSX** (exceljs : en-têtes en gras, montants en KMF format `# ##0`, formules de totaux, onglet « Paramètres du rapport ») et **PDF** (en-tête avec logo Dig'eCom, pagination). Génération en job BullMQ si > 5 000 lignes, lien de téléchargement notifié.
- Rapport « Simulation 100 produits » qui reproduit exactement le tableau de la SPEC §4.1.

### Notifications
- Compléter tous les événements du tableau §7 non encore branchés (stock faible, relevé disponible, abonnement à payer, objectif atteint…).
- Préférences par utilisateur (in-app toujours actif).

### Tests
- Chaque bloc de tableau de bord comparé à une requête de référence sur les données de seed.
- Un export XLSX relu en test : totaux égaux à l'API.
- Un Leader Senior qui demande le rapport d'une autre équipe → 404.

## Critères d'acceptation
- [ ] 10 tableaux de bord conformes au prototype et à la SPEC.
- [ ] Tous les rapports exportables en Excel et PDF, chiffres identiques à l'écran.
- [ ] Temps de réponse du tableau de bord < 800 ms sur 50 000 commandes de test (script de génération fourni).
- [ ] `docs/PROGRESS.md` mis à jour.
