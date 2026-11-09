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
- **Exige le réseau** : enregistrer une vente (vérification du stock en direct).

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

## 7. Appels Dig'eCom (application et back-office)

L'e-commerçant et le livreur d'une même commande peuvent s'appeler **par Internet**, depuis la commande ou la course, sans crédit téléphonique et **sans voir le numéro de l'autre**. L'appel est chiffré de bout en bout (WebRTC) et **n'est jamais enregistré** ; seul un journal (qui, quand, durée, manqué) est gardé sur la commande.

| Situation | Bouton |
| --- | --- |
| Livreur affecté, en route, remise faite ou livraison échouée | **Appel Dig'eCom** (orange) + « Appeler par téléphone » en secours |
| Client final (sans l'application) | Appel téléphonique classique |
| Expo Go, ou téléphone sans le module natif | Appel téléphonique classique (le bouton Dig'eCom est masqué) |

**Annuaire (appels sans commande)**, dans l'application (« 📞 Appels » sur l'accueil) et sur le back-office (bouton « Appels » de l'en-tête, boutons « Appeler » dans le détail d'une commande et la liste des livreurs) :

| Qui | Peut appeler (et être appelé par) |
| --- | --- |
| Administrateur | tout utilisateur actif |
| Assistant logistique | livreurs et e-commerçants de son île |
| Leader Senior | ses e-commerçants |
| Leader Junior | ses téléconseillers |

Sur le back-office, l'appel passe par le navigateur (Chrome, Edge, Firefox récents) : il faut autoriser le micro, et la page doit être ouverte pour recevoir un appel (pas de push sur ordinateur). La règle est dans `packages/shared` (`canCallDirectly`) : l'API, le web et le mobile appliquent la même.

**Déroulement** : l'appelant touche « Appel Dig'eCom » ; le téléphone de l'autre **sonne** (écran d'appel si l'application est ouverte, notification « Appel de … » sinon) ; il décroche ou refuse ; sans réponse en 45 s, l'appel passe en **manqué** et une notification l'indique. Pendant l'appel : micro coupé, haut-parleur, raccrocher. Un seul appel à la fois par personne.

### Ce qu'il faut pour l'activer

1. **Build natif** (WebRTC ne fonctionne pas dans Expo Go) : `eas build -p android --profile development` pour les essais, puis `preview` / `production`.
2. **Relais TURN** sur le VPS (indispensable en 4G : les deux téléphones ne peuvent pas se joindre directement) :
   - dans `.env` : `TURN_SECRET` (généré, voir DEPLOY.md §3), `TURN_EXTERNAL_IP=<IP publique du VPS>`, `TURN_URLS=turn:<domaine>:3478?transport=udp,turn:<domaine>:3478?transport=tcp` ;
   - pare-feu : `sudo ufw allow 3478/udp && sudo ufw allow 3478/tcp && sudo ufw allow 49160:49200/udp` ;
   - démarrage : `docker compose -f compose.prod.yml --profile appels up -d coturn`, puis `up -d api` pour que l'API prenne les nouvelles variables.
3. **Push** (§4) pour que le téléphone sonne application fermée.

Capacité du relais tel que configuré : 40 ports, soit environ **20 appels simultanés relayés** (`--min-port` / `--max-port` à élargir au besoin, avec la règle du pare-feu). Une heure d'appel relayé consomme environ 30 à 50 Mo de bande passante sur le VPS.

### Points techniques

- API : `POST /calls` (appeler : `{ orderId }` ou `{ userId }`), `GET /calls/contacts` (annuaire), `GET /calls/mine` (mes derniers appels), `POST /calls/:id/accept`, `POST /calls/:id/end`, `POST /calls/:id/signal` (relais WebRTC), `GET /calls?orderId=` (journal), `GET /calls/ringing`, `GET /calls/stream` (flux SSE de l'application : appels et statuts des commandes en temps réel).
- Droits : seuls l'e-commerçant et le livreur de la commande ; logistique et administration lisent le journal (cloisonnement par île).
- Identifiants TURN temporaires (1 h) signés par l'API avec `TURN_SECRET` : aucun compte TURN stocké.

## 8. Affectation au plus proche et itinéraires

- **Plus d'offre automatique** : une commande prête est affectée par la personne qui prépare le colis (assistant logistique de l'île). Le back-office lui propose les livreurs de l'île, **disponibles d'abord, puis du plus proche au plus loin du site** (`GET /deliveries/:orderId/candidates`).
- **Positions** : l'application envoie la position du téléphone (`POST /me/location`) : livreur toutes les 2 minutes quand l'application est ouverte et quand il passe « disponible » ; e-commerçant à l'ouverture et à chaque vente. Aucun suivi en arrière-plan. Une position de plus de 30 minutes est « ancienne ».
- **Sites** : position GPS saisie dans Utilisateurs → Sites (coordonnées collées depuis Google Maps ou « Ma position actuelle »).
- **Itinéraires** (Google Maps, sans clé d'API ni facturation) : dans la course, *Itinéraire vers le site* (retrait), puis *Itinéraire vers l'e-commerçant* (sa dernière position) ou vers l'adresse du client en livraison directe. L'e-commerçant peut ouvrir *Voir où est le livreur*.
- **Confidentialité** : la position d'un e-commerçant n'est visible que du livreur affecté à sa commande et du back-office, pendant la course ; celle d'un livreur, que de l'e-commerçant concerné et du back-office.
- Distances à vol d'oiseau (formule de haversine), calculées par l'API.
