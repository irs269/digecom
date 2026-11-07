# Modèle de données (guide pour le schéma Prisma)

Montants : `Int` (KMF). Identifiants : `cuid()` ; les numéros lisibles (commande `CMD-001048`, lot `LOT-014`, campagne `CP-07`) sont des colonnes séparées, uniques, générés par séquence. Toutes les tables ont `createdAt`, `updatedAt` ; les tables métier ont `createdById`.

## Organisation

- **Island** : `code` (`GC`, `AN`, `MO`), `name`.
- **Site** : `name`, `type` (`SHOP`, `WAREHOUSE`), `islandId`, `address`, `isActive`.
- **User** : `fullName`, `phone` (unique, format +269), `email?`, `passwordHash`, `role`, `islandId?`, `siteId?`, `leaderId?` (pour SELLER et TELECONSULTANT), `isActive`, `isAvailable` (COURIER), `lastLoginAt`, `failedLogins`, `lockedUntil?`.
- **TeamAssignmentHistory** : `userId`, `fromLeaderId?`, `toLeaderId`, `reason`, `byId`, `at`.
- **RefreshToken** : `userId`, `tokenHash`, `expiresAt`, `revokedAt?`, `userAgent`, `ip`.

## Catalogue et stock

- **Product** (fiche d'un leader) : `leaderId`, `sku`, `name`, `category`, `description`, `quality`, `photos[]` (clés S3), `salePrice`, `sellerShareType` (`FIXED`|`PERCENT`), `sellerShareValue` (Leader Senior), `tciBonus?` (Leader Junior, 2 000–3 500), `isPublished`, `lowStockThreshold`.
  Le même article chez deux leaders = deux `Product`.
- **StockLevel** (matérialisé) : `productId`, `siteId`, `available`, `reserved` ; unique (`productId`, `siteId`). Mis à jour **uniquement** par le service de mouvements, dans une transaction.
- **StockMovement** (append-only) : `productId`, `siteId`, `type` (`ENTRY`, `RESERVE`, `RELEASE`, `OUT`, `RETURN`, `DAMAGED`, `LOSS`, `TRANSFER_OUT`, `TRANSFER_IN`, `ADJUST`, `INVENTORY_DIFF`), `quantity`, `lotId?`, `orderId?`, `transferId?`, `reason?`, `byId`, `at`.
- **Lot** : `number`, `productId`, `siteId` (destination), `purchaseOrderId?`, `quantity`, `remaining`, `unitCost` (calculé), `receivedAt`. Consommation **FIFO** à la sortie.
- **Supplier** : `name`, `platform` (Alibaba…), `contact`.
- **PurchaseOrder** : `number`, `supplierId`, `productId`, `quantity`, `currency`, `exchangeRate` (décimal stocké en `Decimal`), `purchaseAmountForeign`, `purchaseAmountKmf`, `shippingKmf`, `customsKmf`, `otherFeesKmf`, `destinationSiteId`, `status` (`DRAFT` → `ORDERED` → `IN_TRANSIT` → `ARRIVED` → `IN_CUSTOMS` → `RECEIVED` → `CLOSED`), dates par statut. `unitCost = round((purchase + shipping + customs + other) / quantity)`.
- **Inventory** : `siteId`, `status`, lignes `productId`, `expected`, `counted`, `difference`.

## Ventes et livraisons

- **Order** : `number`, `sellerId`, `sellerType` (`SELLER`|`TELECONSULTANT`), `leaderId`, `campaignId?`, `prospectId?`, `islandId`, `siteId`, `customerName`, `customerPhone`, `customerAddress`, `zone`, `deliveryMode` (`TO_SELLER`, `TO_CUSTOMER`, `PICKUP`), `status`, `courierId?`, `failReason?`, `refuseReason?`, `amountCollected?`, `proofKey?`, horodatages par statut, `createdOnBehalfById?`.
- **OrderItem** : `orderId`, `productId`, `quantity`, **snapshots** : `unitPrice`, `sellerShare`, `sellerTax`, `digecomTax`, `tciBonus`, `unitCost` (FIFO au moment de la sortie).
- **OrderEvent** (frise) : `orderId`, `fromStatus`, `toStatus`, `byId`, `role`, `note`, `at`.
- **DeliveryOffer** : `orderId`, `courierId`, `sentAt`, `response` (`PENDING`, `ACCEPTED`, `TAKEN_BY_OTHER`, `IGNORED`, `EXPIRED`), `respondedAt`.
- **HandoverConfirmation** : `orderId`, `kind` (`PICKUP_FROM_SITE`, `TO_SELLER`, `TO_CUSTOMER`, `SELLER_RECEIVED`, `SITE_HANDOVER`), `byId`, `amountCollected?`, `proofKey?`, `at`.

### Machine à états `OrderStatus`

```
NEW ──confirm──▶ CONFIRMED ──prepare──▶ PREPARING ──ready──▶ READY
READY (mode TO_SELLER / TO_CUSTOMER) ──courier accepts / manual assign──▶ ASSIGNED ──pickup──▶ OUT_FOR_DELIVERY
READY (mode PICKUP) ──site + seller confirm──▶ HANDED_OVER
OUT_FOR_DELIVERY ──handover (+ seller confirm if TO_SELLER)──▶ HANDED_OVER
OUT_FOR_DELIVERY ──fail(reason)──▶ DELIVERY_FAILED ──▶ RETURN_IN_PROGRESS
HANDED_OVER ──client took──▶ SOLD
HANDED_OVER ──client refused(reason)──▶ REFUSED ──▶ RETURN_IN_PROGRESS
RETURN_IN_PROGRESS ──stock check──▶ RETURNED_TO_STOCK | DAMAGED
NEW | CONFIRMED | PREPARING | READY ──cancel(reason)──▶ CANCELLED (stock libéré)
SOLD ──return after sale (admin, reason)──▶ RETURN_IN_PROGRESS (écritures de correction)
```

Stock : `RESERVE` à la création, `OUT` (FIFO, coût figé) à la sortie du site (pickup ou remise site), `RETURN` ou `DAMAGED` au contrôle du retour, `RELEASE` à l'annulation avant sortie.

## Leaders Junior

- **Campaign** : `number`, `leaderId`, `productId`, `name`, `channel` (`FACEBOOK`, `TIKTOK`, `WHATSAPP`, `INSTAGRAM`, `OTHER`), `budget`, `startDate`, `endDate`, `status` (`ACTIVE`, `PAUSED`, `ENDED`). Indicateurs calculés : contacts, confirmées, vendues (`SOLD`), taux, coût par vente.
- **Prospect** : `campaignId`, `fullName`, `phone`, `note?`, `assignedTciId?`, `status` (`TO_CALL`, `UNREACHABLE`, `CONFIRMED`, `NOT_INTERESTED`), `attempts`, `lastCallAt?`, `orderId?`, `importBatchId?`. Doublons détectés par téléphone + campagne.
- **ProspectImportBatch** : `campaignId`, `fileKey`, `rows`, `imported`, `duplicates`, `errors` (JSON), `byId`.
- Gains TCI : calculés à partir des `OrderItem.tciBonus` des commandes `SOLD` du TCI (pas de table de solde modifiable).

## Finance

- **Setting** (versionnée) : `key`, `value` (JSON), `effectiveFrom`, `byId`. Lecture = valeur la plus récente avec `effectiveFrom <= date`.
  Clés : `tax.digecom`, `tax.seller`, `subscription.weekly`, `settlement.cycleDays` (14), `settlement.anchorDate`, `tci.bonusMin` (2000), `tci.bonusMax` (3500), `delivery.noCourierAlertMinutes` (10), `delivery.feePerRun` (1000), `stock.lowThresholdDefault`, `stock.unsoldDaysAlert`.
- **LedgerEntry** (append-only, jamais UPDATE/DELETE) : `type` (`SALE_REVENUE`, `COGS`, `DIGECOM_TAX`, `SELLER_TAX`, `SELLER_COMMISSION`, `TCI_BONUS`, `SUBSCRIPTION`, `COURIER_FEE`, `EXPENSE`, `SUPPLIER_PAYMENT`, `SETTLEMENT_PAYMENT`, `CASH_IN`, `CASH_OUT`, `CORRECTION`), `amount` (signé), `orderId?`, `beneficiaryId?`, `islandId`, `leaderId?`, `campaignId?`, `periodDate`, `reversalOfId?`, `justification?`, `byId`. Les écritures d'une vente sont créées **au passage en `SOLD`**, dans la même transaction.
- **Subscription charge** : écriture `SUBSCRIPTION` hebdomadaire par e-commerçant actif (job planifié lundi 00:00 Indian/Comoro).
- **Settlement** : `sellerId`, `periodStart`, `periodEnd`, `salesCount`, `grossCommission`, `taxes`, `subscriptions`, `otherDeductions`, `carriedOver`, `netToPay`, `status` (`GENERATED` → `VERIFIED` → `APPROVED` → `PAID`), `verifiedById/At`, `approvedById/At`, `paidById/At`, `paymentMethod`, `paymentRef`, `proofKey`. Lignes : `SettlementLine` (référence aux écritures).
- **CashRegister** (une par site) ; **CashSession** : `registerId`, `openedById`, `openingAmount`, `expectedAmount`, `countedAmount`, `difference`, `closedById`, `status`. **CashOperation** : `sessionId`, `direction` (`IN`|`OUT`), `category`, `amount`, `orderId?`, `settlementId?`, `expenseId?`, `byId`, `proofKey?`.
- **Expense** : `category` (`SALARIES`, `RENT`, `ADVERTISING`, `DELIVERY`, `COMMUNICATION`, `ADMIN`, `BANK_FEES`, `OTHER`), `label`, `amount`, `islandId`, `periodDate`, `campaignId?`, `leaderId?`, `proofKey?`, `status` (`PENDING`, `APPROVED`, `REJECTED`), `approvedById?`.
- **BankBalance** : `date`, `amount`, `source` (saisie relevé).

## Transverse

- **Notification** : `userId`, `type`, `title`, `body`, `link`, `payload` (JSON), `readAt?`, `channel` (`IN_APP`, `PUSH`, `SMS`, `WHATSAPP`).
- **AuditLog** (append-only, protégé par un rôle DB sans UPDATE/DELETE) : `actorId?`, `action`, `entity`, `entityId`, `before` (JSON), `after` (JSON), `ip`, `userAgent`, `at`.
- **FileObject** : `key`, `mime`, `size`, `ownerEntity`, `ownerId`, `byId`.
