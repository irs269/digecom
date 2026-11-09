# Guides utilisateur

Une page par profil : ce que vous voyez en arrivant, vos tâches courantes et les règles à connaître. Les captures sont prises sur les données de démonstration ; elles se régénèrent avec la commande en bas de page.

| Profil | Accès | Guide |
| --- | --- | --- |
| Administrateur général | Back-office, tout | [administrateur.md](administrateur.md) |
| Responsable financier | Back-office | [responsable-financier.md](responsable-financier.md) |
| Comptable | Back-office | [comptable.md](comptable.md) |
| Assistant comptable | Back-office | [assistant-comptable.md](assistant-comptable.md) |
| Caissier | Back-office, son site | [caissier.md](caissier.md) |
| Gestionnaire de stock | Back-office, son île | [gestionnaire-stock.md](gestionnaire-stock.md) |
| Assistant logistique | Back-office, son île | [assistant-logistique.md](assistant-logistique.md) |
| Leader Senior | Back-office, son équipe | [leader-senior.md](leader-senior.md) |
| Leader Junior | Back-office, son équipe | [leader-junior.md](leader-junior.md) |
| Téléconseiller | Back-office, ses prospects | [teleconseiller.md](teleconseiller.md) |
| E-commerçant, livreur | Application mobile (phase 8) | [mobile.md](mobile.md) |

## Pour tout le monde

![Connexion](img/connexion.png)

- **Connexion** avec votre numéro de téléphone (+269) et votre mot de passe. À la première connexion, ou après une réinitialisation, l'application impose un nouveau mot de passe.
- **5 essais manqués** verrouillent le compte 15 minutes. Si vous avez oublié votre mot de passe, l'administrateur le réinitialise.
- **Tableau de bord** : vos chiffres et votre liste « À traiter ». Chaque chiffre est cliquable et ouvre la liste correspondante.
- **Cloche** (en haut) : vos notifications, en temps réel. Le lien « Préférences » coupe le push mobile type par type ; les notifications de l'application restent toujours actives.
- **Montants** en KMF, **heures** des Comores. Les montants d'une commande sont figés à sa création : un changement de prix ou de taxe ne modifie pas les commandes passées.
- **Toute action sensible est tracée** : qui, quand, avant et après.

---
Régénérer les captures (développement, données de démonstration) :

```bash
docker compose --profile e2e run --rm -e GUIDES=1 e2e sh -c 'corepack enable && pnpm --filter web exec playwright test e2e/guides --project=desktop'
```


## Guide complet de l’administrateur (PDF)

[Guide-Administrateur-DigeCom.pdf](administrateur/Guide-Administrateur-DigeCom.pdf) : tous les modules du back-office, avec captures d’écran (47 pages).

Régénérer : `node scripts/guide-admin/capture.mjs` (captures, back-office local lancé, `SEED_DEFAULT_PASSWORD` et `CHROMIUM_PATH` définis), puis `node scripts/guide-admin/build-pdf.mjs`. Le texte est dans `administrateur/guide.html`.
