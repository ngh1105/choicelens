-- CreateTable
CREATE TABLE "ComparisonFeedback" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparisonFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComparisonFeedback_comparisonId_createdAt_idx" ON "ComparisonFeedback"("comparisonId", "createdAt");

-- CreateIndex
CREATE INDEX "ComparisonFeedback_userId_createdAt_idx" ON "ComparisonFeedback"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ComparisonFeedback" ADD CONSTRAINT "ComparisonFeedback_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonFeedback" ADD CONSTRAINT "ComparisonFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
