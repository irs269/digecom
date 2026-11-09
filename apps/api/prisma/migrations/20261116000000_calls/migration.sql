-- Phase 8 : appels audio dans l'application (journal, sans enregistrement du son).
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACCEPTED', 'ENDED', 'DECLINED', 'MISSED', 'CANCELLED', 'FAILED');

CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "calleeId" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Call_orderId_createdAt_idx" ON "Call"("orderId", "createdAt");
CREATE INDEX "Call_calleeId_status_idx" ON "Call"("calleeId", "status");
ALTER TABLE "Call" ADD CONSTRAINT "Call_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
