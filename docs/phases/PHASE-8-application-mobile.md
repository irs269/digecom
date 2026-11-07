# Phase 8 – Application mobile Android (e-commerçants et livreurs)

> À lancer **seulement quand le web est en production et stable**. Relis `CLAUDE.md`, `docs/SPEC.md` §5, §7, §8, `docs/PERMISSIONS.md` (SELLER, COURIER) et ouvre `docs/prototype/mobile/` (connexion, e-commerçant, livreur).

## Objectif

Une application **Android** (Expo React Native, iOS plus tard avec le même code) pour deux profils, qui consomme les API déjà créées en phases 3 à 5, avec notifications push, fonctionnement en connexion faible et publication sur le Play Store (test fermé 12 testeurs × 14 jours).

Propose d'abord la structure de l'app, la navigation et la stratégie hors ligne, puis implémente.

## À réaliser

### Socle
- `apps/mobile` : Expo (SDK stable récent), TypeScript, Expo Router, TanStack Query (persistance du cache), react-hook-form + Zod partagés depuis `packages/shared`, thème Dig'eCom (Poppins, bleu, orange).
- Auth : même API ; refresh token stocké dans SecureStore ; déconnexion à distance si compte désactivé.
- Notifications push : Firebase Cloud Messaging via `expo-notifications`, enregistrement du token (`/me/devices`), implémentation `PushProvider` côté API, son et vibration pour les offres de course.
- Hors ligne : file d'actions locale (confirmations, déclarations) rejouée au retour du réseau, avec idempotence côté API (`Idempotency-Key`).
- Images de preuve compressées avant envoi.

### Profil e-commerçant (comme le prototype)
- Accueil : solde du cycle, ventes validées, abonnement retenu, « + Nouvelle vente », à faire, statistiques.
- Nouvelle vente : catalogue **de son leader uniquement** avec stock (rupture = bloqué), client, trois modes de remise, calcul « ce que tu gagnes », enregistrement.
- Commandes : liste, détail avec frise, « J'ai reçu le produit », « J'ai récupéré au site », « Oui, le client a pris » / « Non, refusé » + motif.
- Solde : dernier relevé, détail, cycle en cours, règlements précédents.

### Profil livreur (comme le prototype)
- Bouton Disponible / Indisponible.
- Offre de course (notification + écran) : produit, site de retrait, destination, frais ; Ignorer / Accepter ; disparaît si un autre accepte.
- Course en cours : étapes, « J'ai récupéré le produit », appeler, « J'ai remis le produit » ou remise client avec montant encaissé + photo, « Signaler un problème » (motifs).
- Historique, gains (frais de course), argent encaissé à remettre à la caisse.

### Leader Senior (facultatif dans cette phase)
- Écran simple « Mon catalogue » : stock et publication depuis le téléphone.

### Publication
- Icône et écran de démarrage depuis le logo, nom « Dig'eCom », package `km.digecom.app`.
- EAS Build (profil `preview` APK pour les tests internes, `production` AAB), signature gérée par EAS.
- Fiche Play Store (textes FR, captures), politique de confidentialité, test fermé 12 testeurs pendant 14 jours, puis production.

### Tests
- Unitaires des écrans critiques (Testing Library), e2e Maestro : vente → livraison → client a pris ; offre acceptée par un livreur, retirée chez l'autre.
- Test hors ligne : confirmation faite sans réseau, envoyée au retour, sans doublon.

## Critères d'acceptation
- [ ] Un e-commerçant ne voit que le catalogue de son leader.
- [ ] Un livreur ne reçoit que les courses de son île, notification en moins de 10 s.
- [ ] Les actions faites hors ligne sont rejouées sans doublon.
- [ ] APK de test installable, AAB prêt pour le Play Store.
- [ ] `docs/PROGRESS.md` mis à jour.
