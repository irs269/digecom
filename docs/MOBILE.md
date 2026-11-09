# Application mobile Dig'eCom (Android)

Application **Expo React Native** (`apps/mobile`) pour les **e-commerçants** et les **livreurs**.
Même code pour iOS plus tard. Package Android : `km.digecom.app`.

## 1. Ce que fait l'application

| Profil | Écrans |
| --- | --- |
| E-commerçant | Accueil (solde du cycle, à faire, statistiques) · Nouvelle vente (catalogue de son leader uniquement, trois modes de remise, « ce que tu gagnes ») · Commandes (frise, « J'ai reçu », « Client a pris / refusé ») · Solde (dernier relevé, cycle en cours, règlements) |
| Livreur | Disponible / indisponible · Offres de course (son + vibration, retirées si un autre accepte) · Course en cours (retrait, appel, remise avec montant encaissé et photo, signaler un problème) · Historique · Gains et argent à remettre à la caisse |

Les autres profils se connectent mais sont renvoyés vers le back-office web.

## 2. Fonctionnement hors ligne

- **Lecture** : les données déjà chargées restent affichées sans réseau (cache conservé 24 h sur le téléphone).
- **Actions de terrain** : reçu, récupéré au site, retrait, remise, client a pris / refusé, échec.
  - Sans réseau, l'action est **gardée sur le téléphone** et un bandeau orange l'indique.
  - Elle part **toute seule** au retour du réseau, dans l'ordre.
  - Chaque action porte une **clé unique** (`Idempotency-Key`) : un renvoi après une coupure n'est jamais exécuté deux fois par l'API.
  - Une photo de preuve prise hors ligne est envoyée juste avant l'action.
  - Si le serveur refuse l'action au renvoi (statut déjà changé par quelqu'un d'autre), un bandeau rouge le signale.
- **Exigent le réseau** : enregistrer une vente (vérification du stock en direct) et accepter une course (le premier qui accepte la prend).

## 3. Développer

```bash
pnpm install
make up                                   # API + back-office en local
pnpm --filter mobile start                # Metro ; puis « a » pour l'émulateur Android
```

- L'émulateur Android joint le PC à l'adresse `10.0.2.2` : l'app utilise par défaut `http://10.0.2.2:3100/api` (le back-office relaie `/api/*` vers l'API).
- Téléphone réel sur le même Wi-Fi : `EXPO_PUBLIC_API_URL=http://<IP-du-PC>:3100/api pnpm --filter mobile start`.
- **Expo Go suffit pour les écrans**, mais **pas pour le push** (Android, depuis le SDK 53) : utiliser un build de développement (`eas build -p android --profile development`).

Tests :

```bash
pnpm --filter mobile test                 # Jest : file hors ligne, logique commandes, bandeau
pnpm --filter mobile typecheck
maestro test -e PASSWORD=<mot de passe démo> -e API_URL=http://10.0.2.2:3100/api apps/mobile/.maestro
```

## 4. Notifications push

Chemin : API → **service Expo Push** → **FCM** → téléphone.

1. **Firebase** : créer un projet, ajouter une application Android `km.digecom.app`, télécharger `google-services.json` dans `apps/mobile/`, puis ajouter dans `app.json` : `"android": { "googleServicesFile": "./google-services.json" }`.
2. **Clé FCM V1** : Firebase → Paramètres → Comptes de service → « Générer une clé privée ». La déposer dans EAS avec `eas credentials` → Android → production → *Google Service Account Key for Push Notifications (FCM V1)*. **Ne jamais committer ce fichier JSON.**
3. **Projet EAS** : `cd apps/mobile && eas init`. Cette commande remplit `extra.eas.projectId` dans `app.json`, et l'app en a besoin pour obtenir son jeton push.
4. **API** : dans `.env` de production, mettre `PUSH_ENABLED=true` et, de préférence, `EXPO_ACCESS_TOKEN=<jeton>` (expo.dev → Access tokens ; activer « Enhanced push security »).

Canaux Android :
- `courses` : offres de course, priorité maximale, son et vibration ;
- `default` : tout le reste.

Le livreur peut couper un type de notification dans ses préférences ; la notification in-app reste toujours active.

## 5. Construire

```bash
npm install -g eas-cli && eas login
cd apps/mobile
eas build -p android --profile preview      # APK installable pour les tests internes
eas build -p android --profile production   # AAB pour le Play Store
```

- La signature est **gérée par EAS** : au premier build, accepter « Generate a new Android Keystore ».
- L'adresse de l'API est fixée par profil dans `eas.json` (`EXPO_PUBLIC_API_URL`) : **remplacer `digecom.example.km` par le vrai domaine** avant le premier build `preview` / `production`.
- L'API doit être en ligne en HTTPS : un APK de test ne fonctionne pas contre `localhost`.

## 6. Publier sur le Play Store

1. Compte développeur Google Play (frais uniques), créer l'application « Dig'eCom ».
2. Fiche : textes et captures de [store/fiche-play-store.md](store/fiche-play-store.md) ; politique de confidentialité publiée à une URL publique (texte : [store/politique-confidentialite.md](store/politique-confidentialite.md)).
3. Questionnaires : sécurité des données (téléphone, nom, photos de preuve ; chiffrées en transit ; pas de partage avec des tiers), classification du contenu, public cible (adultes, usage professionnel).
4. **Test fermé** : créer une piste, ajouter **au moins 12 testeurs** (adresses Gmail), envoyer l'AAB (`eas submit -p android --profile production` ou envoi manuel). Les testeurs doivent garder l'application installée **14 jours**.
5. Après les 14 jours, demander l'accès à la production depuis la console, puis publier.

Comptes de test pour l'examen Google : un e-commerçant et un livreur **dédiés**, avec un mot de passe à renseigner dans « Accès à l'application ».
