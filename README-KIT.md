# Kit Claude Code – Plateforme Dig'eCom

Ce dossier contient tout ce qu'il faut pour que Claude Code construise la plateforme, phase par phase, en commençant par l'application web, entièrement sous Docker.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `CLAUDE.md` | Mémoire du projet, lue automatiquement par Claude Code : stack, règles non négociables, conventions, charte |
| `docs/SPEC.md` | Spécification fonctionnelle complète (cahier des charges fusionné) |
| `docs/PERMISSIONS.md` | Rôles, matrice des droits, actions fines, règles de périmètre |
| `docs/DATA-MODEL.md` | Modèle de données et machine à états des commandes |
| `docs/OPEN-QUESTIONS.md` | Questions ouvertes à Dig'eCom et hypothèses appliquées en attendant |
| `docs/PROGRESS.md` | Suivi d'avancement, rempli par Claude Code |
| `docs/phases/PHASE-0 … PHASE-8` | Un prompt par phase, à coller dans Claude Code |
| `docs/prototype/` | Prototypes cliquables web et mobile (référence visuelle) |
| `docs/brand/logo-digecom.jpg` | Logo |

## Mode d'emploi

1. Crée un dépôt vide (par exemple `digecom-platform`) et copie-y **tout le contenu de ce dossier** (à la racine du dépôt).
2. Installe Docker Desktop (ou Docker Engine) et Make. Rien d'autre n'est nécessaire sur ta machine.
3. Ouvre Claude Code à la racine du dépôt.
4. Colle ce message de démarrage :

   > Lis `CLAUDE.md`, puis `docs/phases/PHASE-0-socle-docker.md`. Réalise la phase 0 en suivant exactement ses instructions : propose d'abord ton plan et attends ma validation.

5. Valide le plan, laisse Claude Code travailler, puis vérifie toi-même : `make up`, connexion, tests (`make test`).
6. Quand les critères d'acceptation de la phase sont cochés dans `docs/PROGRESS.md`, ouvre **une nouvelle session** (ou fais `/clear`) et passe à la phase suivante :

   > Lis `CLAUDE.md` et `docs/PROGRESS.md`, puis `docs/phases/PHASE-1-organisation-droits.md`. Réalise la phase 1.

7. Répète jusqu'à la phase 7 (mise en production). La phase 8 (mobile) se lance une fois le web stable en production.

## Conseils

- **Une phase par session** : le contexte reste propre et Claude Code relit la mémoire du projet.
- Commite à la fin de chaque étape validée (`git commit` par phase au minimum) pour pouvoir revenir en arrière.
- Si une phase est trop grosse, demande à Claude Code de la découper en sous-étapes (par exemple phase 4 : calculs → écritures → règlements → caisse → dépenses) et valide chacune.
- Quand Dig'eCom répond à une question ouverte, mets à jour `docs/OPEN-QUESTIONS.md` et demande à Claude Code d'appliquer la décision.
- Ne laisse jamais passer une phase avec des tests rouges : demande « corrige les tests en échec avant de continuer ».

## Ordre et durée indicative (avec ton rythme)

| Phase | Contenu | Durée indicative |
| --- | --- | --- |
| 0 | Socle Docker, auth, mise en page | 1 jour |
| 1 | Utilisateurs, droits, paramètres | 1 jour |
| 2 | Catalogues, stock, achats | 1 à 2 jours |
| 3 | Commandes, livraisons, notifications | 2 jours |
| 4 | Finance | 2 jours |
| 5 | Leaders Junior, TCI | 1 jour |
| 6 | Tableaux de bord, rapports | 1 jour |
| 7 | Production | 1 jour |
| 8 | Mobile Android | 3 à 4 jours + 14 jours de test fermé Play Store |
