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
