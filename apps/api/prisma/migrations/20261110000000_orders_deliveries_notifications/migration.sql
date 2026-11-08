-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'CONFIRMED', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'HANDED_OVER', 'SOLD', 'DELIVERY_FAILED', 'REFUSED', 'RETURN_IN_PROGRESS', 'RETURNED_TO_STOCK', 'DAMAGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('TO_SELLER', 'TO_CUSTOMER', 'PICKUP');

-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('SELLER', 'TELECONSULTANT');

-- CreateEnum
CREATE TYPE "OfferResponse" AS ENUM ('PENDING', 'ACCEPTED', 'TAKEN_BY_OTHER', 'IGNORED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HandoverKind" AS ENUM ('PICKUP_FROM_SITE', 'TO_SELLER', 'TO_CUSTOMER', 'SELLER_RECEIVED', 'SITE_HANDOVER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'SMS', 'WHATSAPP');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerType" "SellerType" NOT NULL,
    "leaderId" TEXT NOT NULL,
    "campaignId" TEXT,
    "prospectId" TEXT,
    "islandId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT,
    "zone" TEXT,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "courierId" TEXT,
    "failReason" TEXT,
    "refuseReason" TEXT,
    "cancelReason" TEXT,
    "note" TEXT,
    "amountCollected" INTEGER,
    "proofKey" TEXT,
    "courierFee" INTEGER,
    "createdOnBehalfById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "outForDeliveryAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "returnStartedAt" TIMESTAMP(3),
    "returnClosedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "sellerShare" INTEGER,
    "sellerTax" INTEGER NOT NULL DEFAULT 0,
    "digecomTax" INTEGER NOT NULL DEFAULT 0,
    "tciBonus" INTEGER,
    "unitCost" INTEGER,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "byId" TEXT,
    "role" "Role",
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOffer" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" "OfferResponse" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverConfirmation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "HandoverKind" NOT NULL,
    "byId" TEXT NOT NULL,
    "amountCollected" INTEGER,
    "proofKey" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "payload" JSONB,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_status_islandId_idx" ON "Order"("status", "islandId");

-- CreateIndex
CREATE INDEX "Order_sellerId_idx" ON "Order"("sellerId");

-- CreateIndex
CREATE INDEX "Order_leaderId_idx" ON "Order"("leaderId");

-- CreateIndex
CREATE INDEX "Order_courierId_idx" ON "Order"("courierId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_at_idx" ON "OrderEvent"("orderId", "at");

-- CreateIndex
CREATE INDEX "DeliveryOffer_courierId_response_idx" ON "DeliveryOffer"("courierId", "response");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOffer_orderId_courierId_key" ON "DeliveryOffer"("orderId", "courierId");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverConfirmation_orderId_kind_key" ON "HandoverConfirmation"("orderId", "kind");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdOnBehalfById_fkey" FOREIGN KEY ("createdOnBehalfById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_islandId_fkey" FOREIGN KEY ("islandId") REFERENCES "Island"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverConfirmation" ADD CONSTRAINT "HandoverConfirmation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverConfirmation" ADD CONSTRAINT "HandoverConfirmation_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Frise des commandes append-only.
CREATE OR REPLACE FUNCTION order_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OrderEvent est append-only : % interdit', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderEvent_append_only"
  BEFORE UPDATE OR DELETE ON "OrderEvent"
  FOR EACH ROW EXECUTE FUNCTION order_event_append_only();
