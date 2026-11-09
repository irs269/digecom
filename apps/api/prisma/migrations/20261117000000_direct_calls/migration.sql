-- Appels directs depuis l'annuaire (sans commande) : web et mobile.
ALTER TABLE "Call" ALTER COLUMN "orderId" DROP NOT NULL;
CREATE INDEX "Call_callerId_createdAt_idx" ON "Call"("callerId", "createdAt");
