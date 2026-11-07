-- CreateTable
CREATE TABLE "TeamAssignmentHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromLeaderId" TEXT,
    "toLeaderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamAssignmentHistory_userId_at_idx" ON "TeamAssignmentHistory"("userId", "at");

-- CreateIndex
CREATE INDEX "TeamAssignmentHistory_toLeaderId_idx" ON "TeamAssignmentHistory"("toLeaderId");

-- AddForeignKey
ALTER TABLE "TeamAssignmentHistory" ADD CONSTRAINT "TeamAssignmentHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamAssignmentHistory" ADD CONSTRAINT "TeamAssignmentHistory_fromLeaderId_fkey" FOREIGN KEY ("fromLeaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamAssignmentHistory" ADD CONSTRAINT "TeamAssignmentHistory_toLeaderId_fkey" FOREIGN KEY ("toLeaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamAssignmentHistory" ADD CONSTRAINT "TeamAssignmentHistory_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

