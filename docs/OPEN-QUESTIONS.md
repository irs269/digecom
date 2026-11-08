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
| T15 | Base des taxes en pourcentage | Taxe e-commerçant : % de la part brute vendeur ; taxe Dig'eCom : % de la part commerciale Dig'eCom (prix − part vendeur). En mode fixe (défaut) : 500 KMF par produit. |
| T16 | Preuve de remise en livraison directe | Montant encaissé obligatoire ; photo de preuve proposée mais facultative (réseau faible). |
| T17 | Annulation par le vendeur | Possible tant que la commande n'est pas confirmée par le site ; ensuite, le site annule (avec motif) jusqu'à « prête ». |
| T18 | Site de préparation | Le site de l'île du vendeur qui a le stock (entrepôt en priorité) ; la logistique peut choisir un autre site de l'île. |
| T19 | Paiement d'un règlement hors espèces | Écriture `SETTLEMENT_PAYMENT` sans opération de caisse ; seules les espèces sortent de la caisse du site. |
| T20 | Abonnement d'un e-commerçant créé en cours de semaine | Premier abonnement prélevé le lundi suivant sa création. |
| T21 | Séparation des tâches pour l'administrateur | L'administrateur peut faire chaque étape, mais jamais vérifier puis valider le même relevé (PERMISSIONS.md). |
| T22 | Taxe Dig'eCom sur une vente TCI | Calculée sur le prix de vente (pas de part vendeur) ; à confirmer avec le partage Dig'eCom / Leader Junior (#7). |
| T23 | Budget de campagne déjà validé | Non modifiable depuis la campagne : la correction passe par une dépense (ou une annulation) côté finance. |
| T24 | Répartition automatique | Prospects « à appeler » non attribués, en round-robin, en commençant par les TCI ayant le moins de prospects en cours. |
| T25 | Quantités attribuées par le Leader Senior | Quota indicatif par e-commerçant et produit (restant = attribué − commandé), sans réservation physique dans le stock du site ; le prototype parle de réservation. À confirmer. |
| T26 | Export des rapports par les leaders | Autorisé pour les rapports de leur équipe (journalier, hebdomadaire, produit, vendeur ; campagnes et gains TCI pour le Leader Junior). |
| T27 | « Sommes dues aux vendeurs » | Relevés non payés + commissions nettes (− taxes − abonnements) pas encore incluses dans un relevé ; les primes TCI n'y figurent pas (pas de circuit de paiement défini). |
| T28 | Objectif « atteint » | Objectif hebdomadaire de CA par équipe (lundi → dimanche), fixé par le leader ou l'administrateur ; une notification par semaine. |
