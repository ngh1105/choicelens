-- Add updatedAt column with default; backfill existing rows
ALTER TABLE "ComparisonFeedback"
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Collapse duplicate (comparisonId, userId) rows to the most recent before
-- enforcing the unique constraint.
DELETE FROM "ComparisonFeedback" cf
USING "ComparisonFeedback" newer
WHERE cf."comparisonId" = newer."comparisonId"
  AND cf."userId" = newer."userId"
  AND (
    cf."createdAt" < newer."createdAt"
    OR (cf."createdAt" = newer."createdAt" AND cf."id" < newer."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonFeedback_comparisonId_userId_key"
    ON "ComparisonFeedback"("comparisonId", "userId");
