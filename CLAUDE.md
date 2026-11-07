# Dig'eCom – Plateforme de gestion commerciale, logistique et financière

Ce fichier est ta mémoire de projet. Relis-le au début de chaque session.

## Le projet en bref

Dig'eCom importe des produits de Chine (Alibaba) et les fait vendre aux Comores (Grande Comore, Anjouan, Mohéli) par un réseau :

- **Leaders Senior** : publient leur propre catalogue (produits, prix, stock) ; leurs **e-commerçants** trouvent eux-mêmes les clients.
- **Leaders Junior** : publient leur catalogue, lancent des **campagnes publicitaires** ; leurs **téléconseillers (TCI)** appellent les prospects et enregistrent les commandes. Prime TCI fixe par produit vendu (2 000 à 3 500 KMF).
- **Livreurs** : reçoivent les courses de **leur île uniquement**, le premier qui accepte la prend.
- **Back-office** : administration, finance, comptabilité, caisse, stock, logistique.

Spécification complète : `docs/SPEC.md`. Droits : `docs/PERMISSIONS.md`. Modèle de données : `docs/DATA-MODEL.md`. Questions ouvertes et hypothèses : `docs/OPEN-QUESTIONS.md`. Avancement : `docs/PROGRESS.md`. Prototypes cliquables (référence visuelle et fonctionnelle) : `docs/prototype/`.

## On avance phase par phase

Les prompts sont dans `docs/phases/`. On réalise **une phase à la fois**, dans l'ordre. Ne commence jamais une phase suivante sans que la précédente soit terminée (tests verts, critères d'acceptation cochés dans `docs/PROGRESS.md`). L'application **web (back-office) vient d'abord** ; l'application mobile arrive en phase 8.

Pour chaque phase :
1. Relis ce fichier, la phase demandée et les docs qu'elle cite.
2. Propose un plan court (fichiers, migrations, endpoints, écrans, tests) et attends la validation si la phase le demande.
3. Implémente par petites étapes vérifiables ; lance les tests après chaque étape.
4. À la fin : tous les tests passent, `docker compose up` démarre proprement, `docs/PROGRESS.md` est mis à jour (fait, reste, décisions prises).

## Stack (imposée)

- **Monorepo pnpm** : `apps/api` (NestJS), `apps/web` (Next.js App Router), `packages/shared` (types, schémas Zod, permissions, calculs), plus tard `apps/mobile` (Expo React Native).
- **Node.js 22 LTS**, **TypeScript strict** partout.
- **API** : NestJS 10+, REST, validation Zod (ou class-validator) sur chaque entrée, OpenAPI généré (`/api/docs`).
- **Base** : PostgreSQL 16 via **Prisma** (migrations versionnées, jamais de `db push` en prod).
- **Files d'attente / jobs** : Redis 7 + BullMQ (délai sans livreur, génération des relevés, notifications).
- **Fichiers** (photos produits, preuves de livraison, justificatifs) : stockage S3 compatible, **MinIO** en local.
- **Web** : Next.js 15, React 19, Tailwind CSS, composants shadcn/ui, TanStack Query, react-hook-form + Zod.
- **Temps réel** : Server-Sent Events (SSE) pour les notifications in-app du back-office.
- **Tests** : Vitest (shared, unitaires), Jest + Supertest (API e2e sur base de test Docker), Playwright (parcours web par rôle).
- **Tout tourne dans Docker** : `compose.yml` (dev) et `compose.prod.yml` (prod).

## Commandes (à créer en phase 0, à garder à jour)

```
make up          # docker compose up -d (postgres, redis, minio, api, web)
make down
make logs
make migrate     # prisma migrate dev dans le conteneur api
make seed        # données de démonstration (mêmes noms que le prototype)
make test        # tests shared + api + web
make e2e         # Playwright
make lint        # eslint + prettier --check + tsc --noEmit
```

## Règles non négociables

1. **Argent en entiers KMF** (`Int`), jamais de float. Affichage `12 500 KMF` (espace insécable comme séparateur de milliers).
2. **Aucune écriture financière ne se modifie ni ne se supprime** : une erreur se corrige par une écriture de correction liée (`reversalOf`) avec justification.
3. **Instantanés (snapshots)** : prix, part vendeur, prime TCI, taxes et coût d'approvisionnement sont copiés sur la commande au moment où elle est créée. Changer un paramètre ou un prix n'affecte jamais les ventes passées.
4. **Coût d'approvisionnement** : rattaché au **lot** (achat + expédition + douane et frais) ; jamais compté deux fois, jamais enregistré comme nouvelle dépense à chaque vente.
5. **Commission / prime définitive** seulement quand la vente est **livrée, acceptée par le client et encaissée** (statut `SOLD`). Refus, échec, annulation : aucune commission.
6. **Cloisonnement par île** : une notification de livraison ne part qu'aux livreurs disponibles de l'île du site. Les rôles de terrain ne voient que leur île.
7. **Cloisonnement par leader** : un e-commerçant ou un TCI ne voit que les produits et le stock publiés par son leader. Un leader ne voit que son catalogue et son équipe.
8. **Contrôle d'accès côté serveur** pour chaque endpoint (rôle + périmètre). Le front masque, le serveur interdit. La matrice vit dans `packages/shared/permissions.ts` et est la seule source de vérité.
9. **Journal d'audit** append-only pour toute création, modification, validation, connexion.
10. **Séparation des tâches** : un règlement passe par comptable (vérifie) → responsable financier (valide) → caissier (paie). Une même personne ne peut pas faire deux étapes, sauf l'administrateur.
11. **Transitions de statut** uniquement via la machine à états de `docs/DATA-MODEL.md` ; toute autre transition renvoie 409.
12. **Concurrence** : l'acceptation d'une course (premier qui accepte) et les mouvements de stock se font dans une transaction avec verrou (`SELECT … FOR UPDATE` ou mise à jour conditionnelle).
13. Fuseau horaire métier : **Indian/Comoro (UTC+3)**. Semaine = lundi → dimanche. Dates stockées en UTC.
14. Ne jamais inventer une règle métier absente de `docs/SPEC.md` : la noter dans `docs/OPEN-QUESTIONS.md`, appliquer l'hypothèse par défaut indiquée et la rendre paramétrable.

## Conventions

- Code, noms de tables, variables : **anglais**. Interface, messages, e-mails, exports : **français**.
- Une migration Prisma par changement de schéma, nommée clairement.
- Erreurs API : format `{ code, message, details }`, codes HTTP corrects (400, 401, 403, 404, 409, 422).
- Pagination côté serveur sur toutes les listes (`page`, `pageSize`, tri, filtres).
- Accessibilité : vrais `<button>`, `<label>` sur les champs, contraste 4.5:1, cibles 44 px.
- Responsive : le back-office doit rester utilisable sur tablette et téléphone.
- Pas de secret dans le dépôt : `.env.example` uniquement.

## Charte graphique

- Bleu roi `#0B2FE0` (principal, menu), orange `#FFA500` (accents, actions fortes), blanc.
- Texte `#0F1535`, texte secondaire `#4A5275`, fond `#F3F5FC`, bordures `#E1E5F2`, texte sur orange `#0A1450`.
- Statuts : vert `#DDF5E5`/`#14532D`, orange `#FFF0D1`/`#7A4100`, bleu `#E6EBFF`/`#0A23B8`, rouge `#FDE2E2`/`#991B1B`.
- Police **Poppins** (400 à 800). Coins arrondis 12 à 18 px. Logo : `docs/brand/logo-digecom.jpg`.
- Reproduire la structure et le ton du prototype `docs/prototype/web/index.html` (menu bleu à gauche, filtre par île en haut, cartes KPI, tableaux, panneau de détail à droite).
