-- AlterTable: Receipt — add submitterKind, creatorAddress, executionResult, errorCode, updatedAt
-- SQLite cannot ALTER TABLE ADD COLUMN with NOT NULL and no default on a populated table,
-- so we use a table-rebuild pattern that backfills the existing demo row with
-- submitterKind='mock' and updatedAt=CURRENT_TIMESTAMP.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comparisonId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "submitterKind" TEXT NOT NULL,
    "creatorAddress" TEXT,
    "contractAddress" TEXT,
    "transactionHash" TEXT,
    "executionResult" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Receipt_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Receipt" (
    "id",
    "comparisonId",
    "payloadHash",
    "status",
    "network",
    "submitterKind",
    "creatorAddress",
    "contractAddress",
    "transactionHash",
    "executionResult",
    "errorCode",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "comparisonId",
    "payloadHash",
    "status",
    "network",
    'mock' AS "submitterKind",
    NULL AS "creatorAddress",
    "contractAddress",
    "transactionHash",
    NULL AS "executionResult",
    NULL AS "errorCode",
    "createdAt",
    CURRENT_TIMESTAMP AS "updatedAt"
FROM "Receipt";
DROP TABLE "Receipt";
ALTER TABLE "new_Receipt" RENAME TO "Receipt";
CREATE UNIQUE INDEX "Receipt_comparisonId_key" ON "Receipt"("comparisonId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
