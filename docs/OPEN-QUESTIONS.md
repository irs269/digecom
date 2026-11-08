# Questions ouvertes et hypothèses par défaut

Tant que Dig'eCom n'a pas répondu, applique l'hypothèse par défaut, rends-la **paramétrable** et ne code rien qui empêche de la changer. Quand une réponse arrive, note-la ici avec la date et la décision.

| # | Question | Hypothèse par défaut appliquée |
| --- | --- | --- |
| 1 | Les produits d'un leader sont-ils achetés par Dig'eCom puis confiés, ou achetés par le leader ? | Les lots (achats Chine) sont rattachés à un produit d'un leader ; le coût du lot sert au coût d'approvisionnement. Le payeur du lot est un champ `paidBy` (`DIGECOM`/`LEADER`). |
| 2 | Comment l'argent d'une vente se partage-t-il entre Dig'eCom, le leader et l'e-commerçant ? | Formule 4.1 de la SPEC ; la part du leader n'est pas calculée (paramètre `leader.share` = 0, affiché « à définir »). |
| 3 | Dig'eCom doit-elle approuver un produit avant publication ? | Non par défaut ; paramètre `catalog.requireApproval` (booléen) prévu. |
| 4 | Où est gardé le stock d'un leader ? | Dans un site Dig'eCom de son île. |
| 5 | Qui paie la prime TCI et le budget publicitaire ? | Écritures rattachées au Leader Junior (`beneficiaryId`, `leaderId`) ; qui supporte la charge reste un paramètre. |
| 6 | Les TCI paient-ils un abonnement ? | Non. |
| 7 | Partage de la marge pour une vente TCI (Dig'eCom / Leader Junior) ? | Non calculé ; seule la prime TCI et le CA sont enregistrés. |
| 8 | Le livreur peut-il encaisser ? Quand remet-il l'argent à la caisse ? | Oui en remise directe ; il remet l'argent au caissier de son île le jour même (opération de caisse « remise livreur »). |
| 9 | Comment sont payés les livreurs ? | Frais fixe par course livrée (`delivery.feePerRun`, 1 000 KMF). |
| 10 | Qui ramène un produit refusé au site, qui paie le trajet ? | Le livreur de la course ; pas de frais supplémentaire. |
| 11 | Taxes de 500 KMF fixes ou proportionnelles ? | Fixes par produit vendu, paramétrables (fixe ou %). |
| 12 | Abonnement dû une semaine sans vente ? Solde négatif ? | Dû ; solde négatif reporté au cycle suivant (`carriedOver`). |
| 13 | Les leaders touchent-ils une commission sur leur équipe ? | Non calculé (paramètre prévu). |
| 14 | Moyens de paiement ? | Espèces, Huri Money, MVola, virement : simple liste paramétrable, pas d'intégration. |
| 15 | Arrivée automatique des prospects (Facebook Lead Ads, WhatsApp) ? | Hors première version : import CSV/Excel et saisie manuelle. |

## Hypothèses techniques ajoutées en phase 0 (2026-11-07)

| # | Sujet | Hypothèse appliquée |
| --- | --- | --- |
| T1 | Format des téléphones | Stockés normalisés `+269XXXXXXX` (7 chiffres) ; la saisie accepte espaces, `00269` ou numéro sans indicatif. |
| T2 | Cookie `Secure` en développement | Désactivable par `COOKIE_SECURE=false` uniquement en dev (http://localhost) ; toujours `true` en production et dans les tests. |
| T3 | Limitation de débit de la connexion | 5 essais (réussis ou non) / 15 min par couple IP + téléphone, compteurs Redis ; verrouillage du compte 15 min après 5 échecs consécutifs, quelle que soit l'IP. Paramétrable (`LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES`, `LOCKOUT_MINUTES`). |
| T4 | Seuils de stock non précisés | `stock.lowThresholdDefault` = 3, `stock.unsoldDaysAlert` = 30 jours (paramètres modifiables). |
| T5 | Date de départ des cycles de règlement | `settlement.anchorDate` = lundi 2026-01-05 (paramètre modifiable). |
| T6 | E-commerçants et livreurs sur le web | Ils peuvent s'authentifier (même API que le futur mobile) mais n'ont aucun module du back-office : le web affiche « Ce profil utilise l'application mobile ». |
| T7 | Réaffectation vers un leader d'une autre île | Le vendeur passe sur l'île du nouveau leader et perd son site ; l'écran le signale avant validation. |
| T8 | Part e-commerçant par défaut (SPEC §6.16) | Paramètre `catalog.defaultSellerShare` = 60 % du prix (7 500 / 12 500 dans l'exemple 4.1), proposé à la création d'un produit. |
| T9 | Politique de mot de passe | 10 caractères minimum, au moins une lettre et un chiffre ; mot de passe temporaire à changer à la première connexion. |
| T10 | Qui gère les sites | L'administrateur, via la permission `users:write` (module Utilisateurs et droits). |
| T11 | Coût unitaire si la quantité reçue diffère de la commande | Coût total ÷ quantité **reçue** (les pertes en transport renchérissent les unités reçues). |
| T12 | Transferts entre îles | Autorisés ; le site de départ doit être dans le périmètre du gestionnaire de stock, l'arrivée peut être sur une autre île. |
| T13 | Stock d'un produit jamais approvisionné | Le premier stock exige un coût unitaire ; ensuite, un ajustement positif prend le coût moyen des lots en stock. |
| T14 | Seuil de stock faible | Seuil propre au produit s'il est renseigné, sinon paramètre `stock.lowThresholdDefault` (3). |
