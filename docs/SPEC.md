# Spécification fonctionnelle – Plateforme Dig'eCom

Version fusionnée du cahier des charges Dig'eCom v3.0 et des besoins exprimés ensuite (îles, livraisons, catalogues par leader, Leaders Junior, téléconseillers). En cas de doute, ce document fait foi ; ce qui manque est listé dans `OPEN-QUESTIONS.md`.

## 1. Contexte

- Achat de marchandises en Chine (Alibaba), transport, dédouanement, stockage dans des sites (boutiques, entrepôts) aux Comores.
- Trois îles : **Grande Comore (GC)**, **Anjouan (AN)**, **Mohéli (MO)**. Chaque site appartient à une île.
- Vente par un réseau, jamais en direct : Leaders Senior + e-commerçants, Leaders Junior + téléconseillers.
- Aujourd'hui tout passe par téléphone ; la plateforme remplace les appels par des commandes, des notifications et des confirmations tracées.

## 2. Acteurs

| Acteur | Application | Rôle |
| --- | --- | --- |
| Administrateur général | Web | Tout : comptes, rôles, paramètres, validations |
| Responsable financier | Web | Valide règlements et dépenses, suit la rentabilité |
| Comptable | Web | Vérifie relevés, taxes, commissions, rapports |
| Assistant comptable | Web | Saisit dépenses, recettes, paiements |
| Caissier | Web | Encaisse, clôture la caisse, paie les règlements validés (son île) |
| Gestionnaire de stock | Web | Stock, transferts, inventaires, arrivages (son île) |
| Assistant logistique | Web | Prépare les commandes, affecte les livreurs (son île) |
| Leader Senior | Web (+ mobile plus tard) | Publie son catalogue, encadre ses e-commerçants |
| Leader Junior | Web | Publie son catalogue, fixe les primes TCI, lance les campagnes, importe les prospects |
| Téléconseiller (TCI) | Web | Appelle ses prospects, enregistre les commandes, clôture les ventes, voit ses gains |
| E-commerçant | Mobile (phase 8) | Vend le catalogue de son leader, confirme réceptions, déclare client pris/refusé |
| Livreur | Mobile (phase 8) | Accepte les courses de son île, confirme retrait/remise, encaisse, preuve |

Détail des droits : `PERMISSIONS.md`.

## 3. Organisation

### 3.1 Îles et sites
- Stock physique suivi **par site** ; vue globale, par île, par site, par leader pour la direction.
- Transferts entre sites/îles = deux mouvements (sortie / entrée), tracés.
- Chaque utilisateur opérationnel a une île (et éventuellement un site), modifiable par l'admin, historisé.

### 3.2 Leaders et catalogues
- Hiérarchie : Dig'eCom → leaders → vendeurs (e-commerçants ou TCI). Un vendeur appartient à un seul leader. Réaffectations historisées.
- **Chaque leader publie son propre catalogue** : nom, photos, description, qualité, prix de vente, part vendeur, stock.
- **Catalogues cloisonnés** : un vendeur ne voit que les produits publiés par son leader et le stock de ce leader.
- **Même article chez plusieurs leaders** possible (prix, qualité différents) : chaque fiche est indépendante.
- **Stock propre à chaque leader** (ex. leader 1 : 3 écouteurs, leader 2 : 5). Une vente décompte le stock du leader du vendeur ; à zéro, la vente est bloquée même si un autre leader en a.
- Publier / retirer un produit ; ajuster le stock avec motif ; un changement de prix ou de prime ne vaut que pour les ventes futures.

### 3.3 Leader Senior vs Leader Junior

| | Leader Senior | Leader Junior |
| --- | --- | --- |
| Catalogue et stock propres | Oui | Oui |
| Vendeurs | E-commerçants | Téléconseillers |
| Qui trouve les clients | Les e-commerçants | Le Leader Junior, par campagnes publicitaires |
| Qui enregistre la vente | L'e-commerçant (mobile) | Le TCI (web), après appel du prospect |
| Rémunération du vendeur | Part e-commerçant − taxe − abonnement | Prime fixe par produit vendu, 2 000 à 3 500 KMF, fixée par le Leader Junior |

## 4. Modèle économique et calculs

### 4.1 Vente d'un e-commerçant (Leader Senior) – exemple de référence obligatoire

| Indicateur | Calcul | KMF |
| --- | --- | --- |
| Prix de vente final | saisi | 12 500 |
| Coût d'approvisionnement | 250 achat + 500 expédition (lot) | 750 |
| Part brute e-commerçant | paramètre produit (fixe ou %) | 7 500 |
| Part commerciale Dig'eCom | 12 500 − 7 500 | 5 000 |
| Marge brute Dig'eCom | 5 000 − 750 | 4 250 |
| Taxe Dig'eCom | paramètre | 500 |
| Marge Dig'eCom après coût et taxe | 4 250 − 500 | 3 750 |
| Taxe e-commerçant | paramètre | 500 |
| Net e-commerçant avant abonnement | 7 500 − 500 | 7 000 |

Simulation 100 produits (doit être retrouvée par les rapports) : achats 25 000, expédition 50 000, coût total 75 000, CA 1 250 000, part Dig'eCom 500 000, part brute e-com 750 000, marge brute 425 000, taxes Dig'eCom 50 000, taxes e-com 50 000, net e-com 700 000, marge après coût et taxe 375 000.

### 4.2 Abonnements et règlements des e-commerçants
- Abonnement **10 000 KMF / semaine** (paramétrable, avec date d'effet).
- **Règlement tous les 14 jours** : net des ventes `SOLD` de la période − 2 abonnements − autres retenues autorisées.
- Exemple : 10 ventes × 7 000 = 70 000 ; − 20 000 = **50 000 KMF**.
- Circuit : généré automatiquement → **vérifié** (comptable) → **validé** (responsable financier) → **payé** (caissier, référence ou preuve). Paiement manuel ; Mobile Money automatique hors première version.
- Le relevé affiche séparément : commissions, taxes, abonnements, autres retenues, net à payer.
- Solde négatif (abonnement > gains) : reporté au cycle suivant (hypothèse, voir questions ouvertes).

### 4.3 Vente d'un TCI (Leader Junior)
- Prime fixe par produit, définie par le Leader Junior à la publication (min 2 000, max 3 500 KMF, bornes paramétrables), copiée sur la commande.
- Prime définitive quand la vente est clôturée **Vendu** (statut `SOLD`).
- Compte TCI : montant vendu, nombre de produits vendus, gains de la semaine, gains globaux, détail par produit (ventes × prime), ventes livrées à clôturer.
- Le budget publicitaire d'une campagne est une dépense rattachée au Leader Junior et à la campagne.
- Partage de la marge entre Dig'eCom et le Leader Junior : **non défini** (voir questions ouvertes) – le stocker comme paramètre, ne pas inventer de règle.

### 4.4 Règles comptables
1. Coût d'approvisionnement jamais compté deux fois ; le paiement fournisseur est enregistré à l'achat.
2. Chaque lot conserve son coût réel ; consommation des lots en **FIFO** par site et produit.
3. Ventes, coûts, taxes, commissions, primes, abonnements enregistrés séparément (écritures distinctes).
4. Commission/prime définitive seulement en `SOLD`.
5. Retour après livraison = écriture de correction, jamais suppression.
6. Toute correction est justifiée et tracée.
7. Taux et montants paramétrables avec date d'effet ; le traitement fiscal définitif est validé par le comptable.
8. **Résultat net** = marge après coût et taxes − charges opérationnelles validées (salaires, loyer, publicité, livraison, communication, frais bancaires, administratifs, autres), affectables à une période et à une île.

## 5. Circuit d'une commande

### 5.1 Création
- E-commerçant (mobile) ou TCI (web, depuis un prospect) ou logistique « pour le compte de » (web, en attendant le mobile).
- Champs : vendeur, leader, produit(s), quantité, prix final, client (nom, téléphone, adresse/quartier, zone), île, site, **mode de remise**.
- Blocage si le stock du leader sur l'île est insuffisant ; à la création, le stock est **réservé**.

### 5.2 Trois modes de remise
1. **Livraison à l'e-commerçant** : un livreur de l'île récupère au site et remet à l'e-commerçant ; double confirmation livreur + e-commerçant.
2. **Livraison directe au client** : le livreur remet au client, saisit le montant encaissé, ajoute une preuve (photo/signature).
3. **Retrait au site** par l'e-commerçant : aucun livreur notifié ; double confirmation site + e-commerçant.
Le site peut changer le mode tant que le produit n'est pas sorti.

### 5.3 Livraisons
- Commande prête (mode 1 ou 2) → notification à **tous les livreurs disponibles de l'île du site**. Le **premier qui accepte** obtient la course ; elle disparaît pour les autres.
- Sans acceptation après un délai paramétrable (défaut 10 min) → alerte à l'assistant logistique, qui affecte manuellement.
- Livraison échouée : motif obligatoire (client injoignable, adresse introuvable, client a refusé…) → retour au site.
- Historique et frais de course par livreur (frais paramétrables par course, défaut 1 000 KMF).

### 5.4 Fin de vente
- Le vendeur (ou le livreur en remise directe) déclare **client a pris** → `SOLD` ou **client a refusé** (motif) → retour.
- Pour les TCI : après livraison, le TCI **clôture** « Vendu » ou « Client a refusé ».
- La direction est notifiée dans les deux cas.
- Retour : contrôle par le gestionnaire de stock → remis en stock ou déclaré endommagé ; corrections financières automatiques.

Machine à états détaillée : `DATA-MODEL.md`.

## 6. Modules du back-office web

1. **Tableau de bord** adapté au rôle (voir prototype) avec filtre par île pour les rôles globaux.
2. **Commandes** : liste filtrable, détail avec frise des étapes, actions selon statut et droits.
3. **Livraisons** : colonnes en attente / en cours / prêtes au retrait / refus et échecs ; liste des livreurs (disponible, en course) ; affectation manuelle.
4. **Stock** : par site, disponible / réservé / vendu, coût rendu, alertes (faible, rupture, invendu depuis X jours, écart d'inventaire), entrées, transferts, inventaires.
5. **Achats Chine** : fournisseurs, commandes fournisseurs = lots, devise et taux de change, frais d'expédition, douane, autres ; coût unitaire calculé ; statuts : en préparation → passée → en transport → arrivée aux Comores → en dédouanement → réceptionnée (entrée en stock) → clôturée.
6. **Réseau commercial** : leaders, équipes, réaffectations, performances.
7. **Catalogues leaders** (« Mon catalogue » pour un leader) : publier, retirer, stock, prix, part vendeur / prime TCI ; panneau « ce que voit chaque équipe ».
8. **Campagnes** (Leader Junior) : nom, produit, canal (Facebook, TikTok, WhatsApp, autre), budget, dates, statut ; contacts, confirmées, vendues, taux de confirmation, coût par vente.
9. **Prospects** : import CSV/Excel ou saisie, répartition entre TCI, statuts à appeler / injoignable / commande confirmée / pas intéressé ; la confirmation crée la commande.
10. **Ventes et gains des TCI** (« Mes ventes et gains » pour un TCI) : par semaine, clôture, détail par produit, tableau par TCI pour le Leader Junior.
11. **Règlements** : cycles de 14 jours, relevés, circuit vérifier → valider → payer.
12. **Caisse** : caisse par site, ouverture, encaissements (dont argent remis par les livreurs), décaissements, clôture avec écart théorique/réel, solde bancaire.
13. **Dépenses** : saisie avec justificatif, validation par le responsable financier, résultat net.
14. **Rapports** : journalier, hebdomadaire, mensuel, par produit, lot, vendeur, leader, île, dépenses, marges, règlements, stocks, campagnes ; export **Excel et PDF**.
15. **Utilisateurs et droits** : comptes, rôles, île/site/leader, matrice des droits, journal d'activité.
16. **Paramètres** : taxes, part vendeur par défaut, abonnement, cycle de règlement (date d'ancrage), bornes de prime TCI, délai sans livreur, frais de course, seuils d'alerte de stock ; chaque changement a une date d'effet.

## 7. Notifications

In-app (SSE) au lancement ; push mobile (FCM) en phase 8 ; WhatsApp Business, SMS, e-mail plus tard.

| Événement | Destinataires |
| --- | --- |
| Nouvelle commande | Site de l'île (logistique), leader |
| Commande prête à livrer | Livreurs disponibles de l'île |
| Commande prête au retrait | Vendeur |
| Course acceptée / affectée | Vendeur, site |
| Aucun livreur après délai | Assistant logistique de l'île |
| Remise effectuée | Vendeur (à confirmer), direction |
| Livraison échouée | Logistique, vendeur |
| Client a pris / a refusé | Direction, caisse / site, logistique |
| Stock faible, rupture | Gestionnaire de stock, leader concerné, direction |
| Relevé disponible, règlement validé, payé | Vendeur, finance |
| Abonnement à payer | E-commerçant |
| Nouveau prospect attribué | TCI |
| Vente clôturée (prime ajoutée) | TCI, Leader Junior |

## 8. Exigences non fonctionnelles

- Interface en français, montants en KMF, fuseau Indian/Comoro.
- Connexions faibles : pages légères, pagination, images compressées (WebP), pas de dépendance lourde côté client.
- Sécurité : mots de passe argon2id, JWT d'accès court (15 min) + refresh token en cookie httpOnly/secure/sameSite, limitation de débit sur la connexion, verrouillage après échecs, CORS strict, en-têtes de sécurité.
- Traçabilité totale (audit), sauvegarde quotidienne de la base, restauration testée.
- Performance : liste de 10 000 commandes paginée < 500 ms côté API ; notification livreur < 10 s.
- Code source, base, accès admin et documentation remis à Dig'eCom.

## 9. Critères de validation globaux

- Test de référence 4.1 exact au KMF près ; simulation 100 produits exacte.
- Exemple de règlement 4.2 exact (50 000 KMF).
- Une commande à Mohéli ne notifie que les livreurs de Mohéli.
- Un vendeur du leader 2 ne voit aucun produit ni stock du leader 1.
- Les trois modes de remise et leurs confirmations fonctionnent.
- Refus, échec, retour : stock et finance corrigés, aucune commission ni prime.
- Un TCI ne voit que ses prospects ; sa prime n'est comptée qu'en `SOLD` ; gains semaine et globaux exacts.
- Séparation des tâches des règlements respectée.
- Chaque rôle n'accède qu'à ce que prévoit `PERMISSIONS.md` (tests automatiques sur chaque endpoint).
