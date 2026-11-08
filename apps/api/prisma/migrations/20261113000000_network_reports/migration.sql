-- Phase 6 : réseau commercial (quotas, objectifs), préférences de notification, index des rapports
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPrefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "SellerAllocation" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "weeklyRevenue" INTEGER NOT NULL,
    "lastReachedWeek" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerAllocation_sellerId_productId_idx" ON "SellerAllocation"("sellerId", "productId");

-- CreateIndex
CREATE INDEX "SellerAllocation_leaderId_idx" ON "SellerAllocation"("leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTarget_leaderId_key" ON "SalesTarget"("leaderId");

-- CreateIndex
CREATE INDEX "Order_status_soldAt_idx" ON "Order"("status", "soldAt");

-- CreateIndex
CREATE INDEX "Order_leaderId_status_soldAt_idx" ON "Order"("leaderId", "status", "soldAt");

-- AddForeignKey
ALTER TABLE "SellerAllocation" ADD CONSTRAINT "SellerAllocation_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerAllocation" ADD CONSTRAINT "SellerAllocation_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerAllocation" ADD CONSTRAINT "SellerAllocation_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerAllocation" ADD CONSTRAINT "SellerAllocation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Journal des quotas append-only : une correction est une ligne négative.
CREATE OR REPLACE FUNCTION seller_allocation_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SellerAllocation est append-only (% interdit)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SellerAllocation_append_only"
  BEFORE UPDATE OR DELETE ON "SellerAllocation"
  FOR EACH ROW EXECUTE FUNCTION seller_allocation_append_only();
