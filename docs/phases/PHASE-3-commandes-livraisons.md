# Phase 3 – Commandes, livraisons par île et notifications

> Prérequis : phase 2 terminée. Relis `CLAUDE.md` (règles 3, 5, 6, 11, 12), `docs/SPEC.md` §5 et §7, `docs/DATA-MODEL.md` (Ventes et livraisons + machine à états), `docs/PERMISSIONS.md` (`orders`, `deliveries`) et `docs/OPEN-QUESTIONS.md` (#8 à #10).

## Objectif

Le circuit complet d'une commande fonctionne de bout en bout depuis le back-office : création, préparation, trois modes de remise, proposition de la course aux **seuls livreurs disponibles de l'île**, premier qui accepte, affectation manuelle, confirmations, client pris ou refusé, retours. Les API destinées au livreur et à l'e-commerçant existent déjà (le mobile les consommera en phase 8).

Commence par un plan (machine à états, endpoints, jobs, événements), puis implémente.

## À réaliser

### Machine à états
- Implémente `OrderStateMachine` dans `packages/shared` (transitions, rôle autorisé, conditions selon `deliveryMode`) et utilise-la côté API et côté web (boutons affichés). Toute transition non prévue → 409.
- Chaque transition : `OrderEvent`, audit, effets de stock via `StockService` (réserve à la création, sortie FIFO au départ du site, release à l'annulation, retour/endommagé au contrôle), notifications.

### Commandes
- `POST /orders` : par `orders:create_on_behalf` (logistique, admin) et par les endpoints vendeur (`/me/orders` pour SELLER, utilisés en phase 8 ; TCI en phase 5). Vérifie que le produit appartient au leader du vendeur, qu'il est publié, que le stock du site de l'île suffit ; copie les **snapshots** (prix, part vendeur, prime TCI, taxes en vigueur via `SettingsService`).
- Liste paginée avec filtres (statut, île, site, leader, vendeur, mode, période, recherche client/téléphone/numéro), détail avec frise, changement de mode avant sortie, annulation avec motif.
- Retours : file « à contrôler » pour le gestionnaire de stock, choix remis en stock ou endommagé.

### Livraisons
- Passage `READY` (mode livraison) → job : crée une `DeliveryOffer` pour chaque livreur `COURIER` **actif, disponible, de l'île du site** et notifie. Test explicite : un livreur d'une autre île ne reçoit jamais l'offre.
- `POST /courier/offers/:orderId/accept` : transaction avec verrou ; le premier gagne (`ASSIGNED`), les autres offres passent `TAKEN_BY_OTHER` et sont retirées en temps réel. Test de concurrence : 10 acceptations simultanées → 1 seule réussit.
- Job BullMQ différé de `delivery.noCourierAlertMinutes` : si toujours `READY`, alerte à l'assistant logistique de l'île.
- `POST /deliveries/:orderId/assign` (manuel, livreur de la même île uniquement).
- Endpoints livreur : disponibilité, offres, mes courses, `pickup`, `handover` (montant encaissé + preuve photo en remise directe), `fail` (motif obligatoire), historique.
- Endpoints e-commerçant : confirmer la réception (mode 1 et 3), déclarer client pris / refusé (motif).
- Mode retrait : confirmation site + vendeur.
- Frais de course : enregistrer le montant `delivery.feePerRun` sur la course livrée (écriture réelle en phase 4).

### Notifications
- Table `Notification`, service `NotificationService.send(users, type, payload)`, flux SSE `GET /notifications/stream` (auth par cookie), liste et marquer comme lu.
- Tous les événements du tableau §7 de la SPEC liés aux commandes et livraisons.
- Préparer une interface `PushProvider` (implémentation FCM en phase 8).

### Web
- **Commandes** comme le prototype : tableau, sélection → panneau de détail (client, vendeur, leader, livreur, statut, frise ✓), boutons selon la machine à états et les droits (« Confirmer et préparer », « Marquer prête », « Affecter un livreur de l'île », « Confirmer le retrait au site », « Client a pris », « Client a refusé », « Contrôler et remettre en stock »), message « Ton profil peut consulter cette commande mais pas la faire avancer » en lecture seule.
- Formulaire « Nouvelle commande pour le compte de » (logistique) avec choix du vendeur → catalogue visible de son leader → stock → mode de remise.
- **Livraisons** : 4 colonnes (en attente d'un livreur, en cours, prêtes au retrait, refus et échecs) mises à jour en temps réel, bouton « Affecter manuellement », liste des livreurs de l'île (disponible / en course, nombre de courses).
- Cloche de notifications dans l'en-tête (non lues, liste, lien vers l'objet).
- Écran temporaire **« Simulateur livreur / vendeur »** réservé à l'admin en environnement de dev, pour jouer les actions mobiles avant la phase 8.

### Tests
- Machine à états : toutes les transitions valides et un échantillon d'invalides.
- E2E pour les trois modes de remise, l'échec, le refus, l'annulation, le retour, avec vérification du stock à chaque étape.
- Isolation par île des offres de course ; premier qui accepte ; alerte sans livreur (horloge simulée).
- Snapshots : changer le prix du produit après la création ne change pas la commande.
- Playwright : logistique de Grande Comore crée une commande pour Fatima Said, la prépare, l'affecte, et un livreur simulé la livre ; la caisse de Mohéli ne voit pas cette commande.

## Critères d'acceptation
- [ ] Une commande à Mohéli ne notifie que les livreurs de Mohéli.
- [ ] Stock toujours cohérent (réservé, sorti, retourné) après chaque scénario.
- [ ] Les trois modes de remise et leurs confirmations fonctionnent.
- [ ] Notifications en temps réel visibles dans le back-office.
- [ ] `docs/PROGRESS.md` mis à jour.
