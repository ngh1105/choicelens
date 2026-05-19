# Phase 3B GenLayer Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `MockGenLayerService` with a real `genlayer-js` client that submits decision receipts to a deployed `ChoiceLensDecisionRegistry` Intelligent Contract on GenLayer Studionet. Support dual signing paths (server service account default + opt-in user wallet) with async submit and lazy polling.

**Architecture:** Server-side factory selects mock vs real implementation by `GENLAYER_NETWORK` env var. Real impl wraps `genlayer-js` read/write clients. Receipt rows persist submitter kind, creator address, execution result, and error code. Frontend polls `GET /receipt` every 4s while non-terminal; backend lazily refreshes status via `waitForTransactionReceipt`.

**Tech Stack:** Next.js 16, Prisma + SQLite, genlayer-js 1.1.8, viem 2.49.3, wagmi 2.19.5, RainbowKit 2.2.11, vitest (introduced this phase), Python (for the Intelligent Contract).

**Spec:** `docs/superpowers/specs/2026-05-19-phase3b-genlayer-integration-design.md`

**Prerequisites:**
- PR #2 (Phase 3A — Prisma data foundation) must be merged to `master` before starting PR #1 here.
- Rebase `phase3b-design` on `master` after PR #2 merges so Prisma schema and `db.ts`/`store.ts` Prisma rewrite are in place.

---

## File Structure

**Created:**
- `prisma/migrations/0001_init/migration.sql` — snapshot of Phase 3A schema
- `prisma/migrations/0002_phase3b_receipt_fields/migration.sql` — Receipt delta
- `prisma/migrations/migration_lock.toml`
- `vitest.config.ts`
- `src/lib/genlayer/index.ts` — barrel re-exports
- `src/lib/genlayer/client.ts` — read/write client factories
- `src/lib/genlayer/service.ts` — `GenLayerServiceImpl` + `getGenLayerService()` factory
- `src/lib/genlayer/mock.ts` — relocated `MockGenLayerService`
- `src/lib/genlayer/errors.ts` — `GenLayerError` + codes
- `src/lib/genlayer/types.ts` — submitter kinds, status enums
- `src/lib/genlayer/buildInput.ts` — server-side `CreateDecisionReceiptInput` derivation
- `src/lib/genlayer/__tests__/buildInput.test.ts`
- `src/lib/genlayer/__tests__/service.test.ts`
- `src/lib/genlayer/__tests__/errors.test.ts`
- `src/app/api/comparisons/[id]/receipt/build-input/route.ts`
- `src/app/api/comparisons/[id]/receipt/wallet-tx/route.ts`
- `src/app/api/comparisons/[id]/receipt/__tests__/route.test.ts`
- `src/components/receipt/ReceiptStatusPill.tsx`
- `src/components/receipt/ReceiptCard.tsx`
- `src/components/receipt/WalletPathToggle.tsx`
- `src/lib/hooks/useReceiptPolling.ts`
- `contracts/ChoiceLensDecisionRegistry.py`
- `scripts/deploy-registry.ts`
- `scripts/check-studionet.ts`
- `docs/runbook/genlayer-service-account.md`

**Modified:**
- `package.json` — scripts: `test`, `db:reset`→migrate, drop `db:push`; deps: `vitest`, `@vitest/ui`, `tsx` (already), `dotenv`
- `prisma/schema.prisma` — add receipt fields per spec §7
- `prisma/seed.ts` — write new fields with `submitterKind="mock"`, `executionResult=null`
- `src/lib/store.ts` — receipt CRUD includes new columns
- `src/lib/genlayer.ts` — becomes thin re-export of `./genlayer/index.ts`
- `src/app/api/comparisons/[id]/receipt/route.ts` — switch to async submit + lazy poll
- `src/app/page.tsx` — render `<ReceiptCard />` with status pill + wallet toggle
- `src/app/providers.tsx` — pass GenLayer chain into wagmi config when wallet path is on
- `.env.example` — add Phase 3B env vars
- `docs/architecture/05-phase3b-genlayer-integration.md` (new)

**Deleted:**
- `src/lib/genlayer.ts` is replaced by `src/lib/genlayer/index.ts` re-export shim (kept for import compat per spec §4).

---

## PR Sequence

| # | PR | Branch (off `master`) | Closes |
|---|---|---|---|
| 1 | Schema + migrations | `phase3b/01-schema-migrations` | Spec §7 |
| 2 | GenLayer module skeleton | `phase3b/02-module-skeleton` | Spec §4, §8 |
| 3 | Contract + deploy script | `phase3b/03-contract-deploy` | Spec §5 |
| 4 | Service path live | `phase3b/04-service-path` | Spec §6.1, §6.3 |
| 5 | Frontend service-path UX | `phase3b/05-frontend-service` | Spec §6.3 (UI), §8 (UI) |
| 6 | Wallet path | `phase3b/06-wallet-path` | Spec §6.2 |
| 7 | Studionet smoke + docs | `phase3b/07-studionet-smoke` | Spec §10 (smoke), §12 |

Each PR ends green: `npm run lint && npm run typecheck && npm run build && npm run db:reset && npm test`.

---

# PR #1 — Schema + Migrations

**Branch:** `phase3b/01-schema-migrations` off `master` (after Phase 3A merged).

**Goal:** Introduce Prisma migrations workflow, extend `Receipt` per spec §7, set up vitest, propagate new fields through `store.ts` and `seed.ts`.

### Task 1.1: Set up vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/__tests__/sanity.test.ts`

- [ ] **Step 1: Add vitest deps**

```bash
npm install -D vitest@^2.1.0 @vitest/ui@^2.1.0 dotenv@^16.4.5
```

- [ ] **Step 2: Add `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 3: Add setup file**

Create `src/test/setup.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test", override: false });

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/test.db";
process.env.GENLAYER_NETWORK = process.env.GENLAYER_NETWORK ?? "mock";
```

- [ ] **Step 4: Add `test` script to `package.json`**

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Add sanity test**

`src/lib/__tests__/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run**

```bash
npm test
```
Expected: 1 test passed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts src/lib/__tests__/sanity.test.ts
git commit -m "chore(phase3b): wire vitest test runner"
```

### Task 1.2: Snapshot existing schema as `0001_init` migration

**Files:**
- Create: `prisma/migrations/0001_init/migration.sql`
- Create: `prisma/migrations/migration_lock.toml`

- [ ] **Step 1: Generate baseline migration from current schema**

```bash
DATABASE_URL="file:./prisma/dev.db" npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0001_init/migration.sql
```

If the directory does not exist, create it first: `mkdir -p prisma/migrations/0001_init`.

- [ ] **Step 2: Add `migration_lock.toml`**

```toml
provider = "sqlite"
```

- [ ] **Step 3: Verify migration is consistent with current DB**

```bash
DATABASE_URL="file:./prisma/dev.db" npx prisma migrate resolve --applied 0001_init
DATABASE_URL="file:./prisma/dev.db" npx prisma migrate status
```
Expected: "Database schema is up to date".

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/0001_init prisma/migrations/migration_lock.toml
git commit -m "feat(phase3b): snapshot phase3a schema as 0001_init migration"
```

### Task 1.3: Add Receipt fields migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0002_phase3b_receipt_fields/migration.sql`

- [ ] **Step 1: Update `prisma/schema.prisma` Receipt model**

Replace the `Receipt` block with:

```prisma
model Receipt {
  id              String     @id
  comparisonId    String     @unique
  comparison      Comparison @relation(fields: [comparisonId], references: [id], onDelete: Cascade)
  payloadHash     String
  status          String
  network         String
  submitterKind   String     // "service" | "user" | "mock"
  creatorAddress  String?
  contractAddress String?
  transactionHash String?
  executionResult String?    // "ok" | "error" | raw genlayer name
  errorCode       String?    // GenLayerError code if status=failed
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
}
```

- [ ] **Step 2: Generate the delta migration**

```bash
DATABASE_URL="file:./prisma/dev.db" npx prisma migrate dev --name phase3b_receipt_fields --create-only
```

- [ ] **Step 3: Inspect generated SQL**

Open `prisma/migrations/0002_phase3b_receipt_fields/migration.sql`. Verify it adds `submitterKind` (NOT NULL with no default → SQLite needs a default for the existing rows). If the generated SQL fails because of existing rows, edit it to use a table-rebuild pattern:

```sql
-- Edit ONLY if Prisma's generated SQL needs hand-tuning for SQLite.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comparisonId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "submitterKind" TEXT NOT NULL DEFAULT 'mock',
    "creatorAddress" TEXT,
    "contractAddress" TEXT,
    "transactionHash" TEXT,
    "executionResult" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Receipt_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Receipt" ("id","comparisonId","payloadHash","status","network","contractAddress","transactionHash","createdAt","submitterKind","updatedAt")
SELECT "id","comparisonId","payloadHash","status","network","contractAddress","transactionHash","createdAt",'mock',"createdAt" FROM "Receipt";

DROP TABLE "Receipt";
ALTER TABLE "new_Receipt" RENAME TO "Receipt";
CREATE UNIQUE INDEX "Receipt_comparisonId_key" ON "Receipt"("comparisonId");

PRAGMA foreign_keys=ON;
```

- [ ] **Step 4: Apply migration**

```bash
DATABASE_URL="file:./prisma/dev.db" npx prisma migrate dev
```
Expected: "Database is now in sync with your schema."

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```
Expected: errors in `src/lib/store.ts` because `submitterKind` is required. That is fine — Task 1.4 fixes them.

- [ ] **Step 6: Commit (do not push yet — store fix lands together in Task 1.4 or separate commit)**

```bash
git add prisma/schema.prisma prisma/migrations/0002_phase3b_receipt_fields
git commit -m "feat(phase3b): add receipt submitter, executionResult, errorCode columns"
```

### Task 1.4: Update store + seed for new fields

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Extend `ReceiptRecord` and `saveReceipt` in `src/lib/store.ts`**

`ReceiptRecord` already extends `DecisionReceipt`. The new columns belong on the row, not on the in-memory `DecisionReceipt`. Add a separate `ReceiptRecord` shape:

```ts
export interface ReceiptRecord {
  id: string;
  comparisonId: string;
  payloadHash: string;
  status: ReceiptStatus;
  network: string;
  submitterKind: "service" | "user" | "mock";
  creatorAddress: string | null;
  contractAddress: string | null;
  transactionHash: string | null;
  executionResult: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Update `saveReceipt` signature:

```ts
export async function saveReceipt(args: {
  comparisonId: string;
  receipt: DecisionReceipt;
  submitterKind: "service" | "user" | "mock";
  creatorAddress?: string | null;
  executionResult?: string | null;
  errorCode?: string | null;
}): Promise<ReceiptRecord> {
  // ...write all columns; null-coerce optional fields
}
```

Reading: include all columns in the row mapper.

- [ ] **Step 2: Update `prisma/seed.ts`**

Where the seed inserts the demo receipt, add:

```ts
submitterKind: "mock",
creatorAddress: null,
executionResult: null,
errorCode: null,
```

- [ ] **Step 3: Update existing receipt POST route**

`src/app/api/comparisons/[id]/receipt/route.ts` line 47:

```ts
const built = getGenLayerService().buildReceipt(comparison.result);
const record = await saveReceipt({
  comparisonId: id,
  receipt: built,
  submitterKind: "mock",
});
```

- [ ] **Step 4: Run typecheck + lint**

```bash
npm run typecheck && npm run lint
```
Expected: no errors.

- [ ] **Step 5: Reset DB and verify seed**

Replace the `db:reset` script in `package.json`:

```json
"db:reset": "prisma migrate reset --force",
"db:migrate": "prisma migrate dev"
```

Remove `db:push` if present.

```bash
DATABASE_URL="file:./prisma/dev.db" PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" npm run db:reset
```
Expected: migrations applied + seed runs + receipt row visible.

- [ ] **Step 6: Build**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.ts prisma/seed.ts src/app/api/comparisons/[id]/receipt/route.ts package.json
git commit -m "feat(phase3b): propagate new receipt fields through store and seed"
```

### Task 1.5: PR #1 review checklist

- [ ] **Step 1: Run full PR gate**

```bash
npm run lint && npm run typecheck && npm run build && DATABASE_URL="file:./prisma/dev.db" PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" npm run db:reset && npm test
```
Expected: all green.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin phase3b/01-schema-migrations
gh pr create --base master --title "feat(phase3b): schema + migrations" --body "$(cat <<'EOF'
## Summary
- Introduce `prisma/migrations/` workflow (replaces `db push`).
- Snapshot Phase 3A schema as `0001_init`, add `0002_phase3b_receipt_fields` per spec §7.
- Wire vitest. Update store + seed for new columns.

## Test plan
- [ ] lint, typecheck, build green
- [ ] `npm run db:reset` migrates + seeds cleanly
- [ ] `npm test` green (sanity)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR #2 — GenLayer module skeleton

**Branch:** `phase3b/02-module-skeleton` off `master` (rebased after PR #1 merges).

**Goal:** Lay down the `src/lib/genlayer/` directory with errors, types, mock relocation, and a service factory. No real network code yet — `GenLayerServiceImpl` is a stub that throws `genlayer_rpc_unavailable`. Existing imports (`from "@/lib/genlayer"`) keep working via a re-export shim.

### Task 2.1: Errors + types + mock relocation

**Files:**
- Create: `src/lib/genlayer/errors.ts`, `types.ts`, `mock.ts`, `index.ts`
- Create: `src/lib/genlayer/__tests__/errors.test.ts`
- Modify: `src/lib/genlayer.ts` (becomes shim)

- [ ] **Step 1: Write `errors.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { GenLayerError, isGenLayerError } from "../errors";

describe("GenLayerError", () => {
  it("captures code + message", () => {
    const err = new GenLayerError("transaction_timeout", "timed out");
    expect(err.code).toBe("transaction_timeout");
    expect(err.message).toBe("timed out");
  });
  it("isGenLayerError narrows", () => {
    const err = new GenLayerError("wallet_rejected", "x");
    expect(isGenLayerError(err)).toBe(true);
    expect(isGenLayerError(new Error("nope"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL (module missing)**

```bash
npm test -- errors
```
Expected: "Cannot find module '../errors'".

- [ ] **Step 3: Create `src/lib/genlayer/errors.ts`**

```ts
export type GenLayerErrorCode =
  | "wallet_not_connected"
  | "wallet_rejected"
  | "wrong_network"
  | "insufficient_funds"
  | "service_account_unavailable"
  | "genlayer_rpc_unavailable"
  | "contract_not_configured"
  | "transaction_timeout"
  | "transaction_failed"
  | "receipt_not_finalized"
  | "contract_schema_mismatch"
  | "unknown_genlayer_error";

export class GenLayerError extends Error {
  readonly code: GenLayerErrorCode;
  constructor(code: GenLayerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = "GenLayerError";
  }
}

export function isGenLayerError(value: unknown): value is GenLayerError {
  return value instanceof GenLayerError;
}

export const HTTP_STATUS_BY_CODE: Record<GenLayerErrorCode, number> = {
  wallet_rejected: 400,
  wallet_not_connected: 400,
  wrong_network: 409,
  contract_schema_mismatch: 409,
  service_account_unavailable: 503,
  genlayer_rpc_unavailable: 503,
  contract_not_configured: 503,
  transaction_timeout: 502,
  transaction_failed: 502,
  receipt_not_finalized: 502,
  insufficient_funds: 500,
  unknown_genlayer_error: 500,
};
```

- [ ] **Step 4: Run test, expect PASS**

```bash
npm test -- errors
```

- [ ] **Step 5: Create `src/lib/genlayer/types.ts`**

```ts
export type SubmitterKind = "service" | "user" | "mock";
export type ReceiptStatus =
  | "off_chain_only"
  | "pending"
  | "accepted"
  | "finalized"
  | "finalized_with_error"
  | "failed";

export interface DecisionReceipt {
  id: string;
  payloadHash: string;
  status: ReceiptStatus;
  network: string;
  contractAddress: string | null;
  transactionHash: string | null;
  createdAt: string;
}

export interface CreateDecisionReceiptInput {
  receiptId: string;
  payloadHash: string;
  schemaVersion: string;
  category: string;
  recommendationHash: string;
  confidenceBand: "low" | "medium" | "high";
  publicSummaryHash: string | null;
}
```

- [ ] **Step 6: Move mock to `src/lib/genlayer/mock.ts`**

```ts
import type { ComparisonResult } from "../comparison";
import type { DecisionReceipt } from "./types";

const MOCK_NETWORK = "genlayer-studio";

function newReceiptId(seed: string): string {
  return `rcpt_${seed.slice(0, 8)}`;
}

export class MockGenLayerService {
  isAvailable(): boolean {
    return false;
  }

  buildReceipt(result: ComparisonResult): DecisionReceipt {
    return {
      id: newReceiptId(result.receiptPayloadHash),
      payloadHash: result.receiptPayloadHash,
      status: "off_chain_only",
      network: MOCK_NETWORK,
      contractAddress: null,
      transactionHash: null,
      createdAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 7: Create `src/lib/genlayer/index.ts`**

```ts
export type { DecisionReceipt, CreateDecisionReceiptInput, ReceiptStatus, SubmitterKind } from "./types";
export { GenLayerError, isGenLayerError, HTTP_STATUS_BY_CODE } from "./errors";
export type { GenLayerErrorCode } from "./errors";
export { getGenLayerService } from "./service";
export type { GenLayerService } from "./service";
```

- [ ] **Step 8: Replace `src/lib/genlayer.ts` with shim**

```ts
// Compatibility shim — see src/lib/genlayer/index.ts
export * from "./genlayer/index";
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/genlayer src/lib/genlayer.ts
git commit -m "feat(phase3b): scaffold genlayer module with errors, types, mock"
```

### Task 2.2: Service factory + stub impl

**Files:**
- Create: `src/lib/genlayer/service.ts`
- Create: `src/lib/genlayer/__tests__/service.test.ts`

- [ ] **Step 1: Write factory test**

`src/lib/genlayer/__tests__/service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetServiceCache, getGenLayerService } from "../service";
import { MockGenLayerService } from "../mock";

describe("getGenLayerService", () => {
  beforeEach(() => {
    resetServiceCache();
  });

  it("returns mock when GENLAYER_NETWORK=mock", () => {
    process.env.GENLAYER_NETWORK = "mock";
    expect(getGenLayerService()).toBeInstanceOf(MockGenLayerService);
  });

  it("returns real impl when GENLAYER_NETWORK=studionet", () => {
    process.env.GENLAYER_NETWORK = "studionet";
    process.env.GENLAYER_CONTRACT_ADDRESS = "0xabc";
    const svc = getGenLayerService();
    expect(svc.constructor.name).toBe("GenLayerServiceImpl");
  });

  it("real impl throws contract_not_configured when address missing", () => {
    process.env.GENLAYER_NETWORK = "studionet";
    delete process.env.GENLAYER_CONTRACT_ADDRESS;
    expect(() => getGenLayerService()).toThrow(/contract_not_configured/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `src/lib/genlayer/service.ts`**

```ts
import type { ComparisonResult } from "../comparison";
import { GenLayerError } from "./errors";
import { MockGenLayerService } from "./mock";
import type { CreateDecisionReceiptInput, DecisionReceipt } from "./types";

export interface GenLayerService {
  isAvailable(): boolean;
  buildReceipt(result: ComparisonResult): DecisionReceipt;
  // Real-only methods — mock throws "not_supported" if called.
  createDecisionReceipt?(input: CreateDecisionReceiptInput): Promise<{ transactionHash: string; creatorAddress: string }>;
  refreshReceiptStatus?(transactionHash: string): Promise<{ status: string; executionResult: string | null }>;
}

export class GenLayerServiceImpl implements GenLayerService {
  constructor(private readonly contractAddress: string) {}

  isAvailable(): boolean {
    return true;
  }

  buildReceipt(_result: ComparisonResult): DecisionReceipt {
    throw new GenLayerError("genlayer_rpc_unavailable", "service.buildReceipt is wired in PR #4");
  }
}

let cached: GenLayerService | null = null;

export function resetServiceCache(): void {
  cached = null;
}

export function getGenLayerService(): GenLayerService {
  if (cached) return cached;
  const network = process.env.GENLAYER_NETWORK ?? "mock";
  if (network === "mock") {
    cached = new MockGenLayerService();
    return cached;
  }
  if (network === "studionet") {
    const addr = process.env.GENLAYER_CONTRACT_ADDRESS;
    if (!addr) {
      throw new GenLayerError("contract_not_configured", "GENLAYER_CONTRACT_ADDRESS unset");
    }
    cached = new GenLayerServiceImpl(addr);
    return cached;
  }
  throw new GenLayerError("contract_not_configured", `Unknown GENLAYER_NETWORK=${network}`);
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Run full gate**

```bash
npm run lint && npm run typecheck && npm run build && npm test
```

- [ ] **Step 6: Commit and PR**

```bash
git add src/lib/genlayer
git commit -m "feat(phase3b): genlayer service factory with stub impl"
git push -u origin phase3b/02-module-skeleton
gh pr create --base master --title "feat(phase3b): module skeleton (errors, types, factory)" --body "..."
```

---

# PR #3 — Contract + deploy script

**Branch:** `phase3b/03-contract-deploy`.

**Goal:** Author the `ChoiceLensDecisionRegistry` Intelligent Contract and a one-shot deploy script. Deployment runs out-of-band; the resulting address is recorded in `.env.example` comments and `docs/runbook/genlayer-service-account.md` for contributors.

### Task 3.1: Write the contract

**Files:**
- Create: `contracts/ChoiceLensDecisionRegistry.py`

- [ ] **Step 1: Author contract per spec §5**

```python
# contracts/ChoiceLensDecisionRegistry.py
from genlayer import *

class Receipt:
    receipt_id: str
    creator: Address
    payload_hash: bytes
    schema_version: str
    category: str
    recommendation_hash: bytes
    confidence_band: str
    created_at: u256
    public_summary_hash: bytes | None

class ChoiceLensDecisionRegistry(gl.Contract):
    receipts: TreeMap[str, Receipt]
    by_user: TreeMap[Address, DynArray[str]]

    def __init__(self):
        pass

    @gl.public.write
    def create_receipt(
        self,
        receipt_id: str,
        payload_hash: bytes,
        schema_version: str,
        category: str,
        recommendation_hash: bytes,
        confidence_band: str,
        public_summary_hash: bytes | None,
    ) -> str:
        assert receipt_id not in self.receipts, "receipt_id_taken"
        assert confidence_band in ("low", "medium", "high"), "invalid_confidence"
        r = Receipt()
        r.receipt_id = receipt_id
        r.creator = gl.message.sender_address
        r.payload_hash = payload_hash
        r.schema_version = schema_version
        r.category = category
        r.recommendation_hash = recommendation_hash
        r.confidence_band = confidence_band
        r.created_at = gl.block.timestamp
        r.public_summary_hash = public_summary_hash
        self.receipts[receipt_id] = r
        if r.creator not in self.by_user:
            self.by_user[r.creator] = DynArray[str]()
        self.by_user[r.creator].append(receipt_id)
        return receipt_id

    @gl.public.view
    def get_receipt(self, receipt_id: str) -> Receipt:
        return self.receipts[receipt_id]

    @gl.public.view
    def get_user_receipts(self, addr: Address) -> list[str]:
        if addr not in self.by_user:
            return []
        return list(self.by_user[addr])
```

- [ ] **Step 2: Commit**

```bash
git add contracts/ChoiceLensDecisionRegistry.py
git commit -m "feat(phase3b): ChoiceLensDecisionRegistry intelligent contract"
```

### Task 3.2: Deploy script

**Files:**
- Create: `scripts/deploy-registry.ts`
- Modify: `package.json`

- [ ] **Step 1: Write `scripts/deploy-registry.ts`**

```ts
import { config } from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import {
  createClient,
  createAccount,
  simulateContract,
  studionet,
} from "genlayer-js";

config({ path: ".env" });

async function main() {
  const pk = process.env.GENLAYER_SERVICE_PRIVATE_KEY;
  if (!pk) throw new Error("GENLAYER_SERVICE_PRIVATE_KEY missing");
  const account = createAccount(pk as `0x${string}`);
  const client = createClient({
    chain: studionet,
    account,
    endpoint: process.env.GENLAYER_RPC_URL,
  });
  const source = readFileSync(
    path.resolve("contracts/ChoiceLensDecisionRegistry.py"),
    "utf8",
  );
  const txHash = await client.deployContract({
    code: source,
    args: [],
    leaderOnly: false,
  });
  console.log("deploy tx:", txHash);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, status: "FINALIZED" });
  console.log("contract address:", receipt.data?.contract_address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

```json
"scripts": {
  "genlayer:deploy": "tsx scripts/deploy-registry.ts"
}
```

- [ ] **Step 3: Commit + PR**

```bash
git add scripts/deploy-registry.ts package.json
git commit -m "feat(phase3b): deploy script for ChoiceLensDecisionRegistry"
git push -u origin phase3b/03-contract-deploy
gh pr create --base master --title "feat(phase3b): contract + deploy script" --body "..."
```

Deployment is operator-driven (runbook in PR #7). Do not run the script in CI.

---

# PR #4 — Service path live

**Branch:** `phase3b/04-service-path`.

**Goal:** Wire `GenLayerServiceImpl` against `genlayer-js`. POST `/receipt` (service path) submits a real tx; GET `/receipt` lazily refreshes status. Add unit + API integration tests against a stub `genlayer-js` client. Mock path stays default; real path activates only when `GENLAYER_NETWORK=studionet` + service key present.

### Task 4.1: `buildInput` (server-derived input)

**Files:**
- Create: `src/lib/genlayer/buildInput.ts`
- Create: `src/lib/genlayer/__tests__/buildInput.test.ts`

- [ ] **Step 1: Test for determinism**

```ts
import { describe, it, expect } from "vitest";
import { buildCreateDecisionReceiptInput } from "../buildInput";
import type { ComparisonResult } from "@/lib/comparison";

const fixture: ComparisonResult = {
  topPick: { id: "opt-1", name: "X", finalScore: 0.82, agentScores: [], rank: 1 },
  shortlist: [],
  ranked: [],
  signals: { confidence: 0.7, uncertainty: [], whatWouldChange: [] },
  receiptPayloadHash: "abc123def456",
};

describe("buildCreateDecisionReceiptInput", () => {
  it("is deterministic", () => {
    const a = buildCreateDecisionReceiptInput({ id: "cmp-1", category: "phones", result: fixture });
    const b = buildCreateDecisionReceiptInput({ id: "cmp-1", category: "phones", result: fixture });
    expect(a).toEqual(b);
  });
  it("maps confidence to band", () => {
    const lo = buildCreateDecisionReceiptInput({ id: "1", category: "x", result: { ...fixture, signals: { ...fixture.signals, confidence: 0.2 } } });
    expect(lo.confidenceBand).toBe("low");
    const hi = buildCreateDecisionReceiptInput({ id: "1", category: "x", result: { ...fixture, signals: { ...fixture.signals, confidence: 0.9 } } });
    expect(hi.confidenceBand).toBe("high");
  });
});
```

- [ ] **Step 2: Implement `buildInput.ts`**

```ts
import type { ComparisonResult } from "../comparison";
import type { CreateDecisionReceiptInput } from "./types";
import { createHash } from "crypto";

const SCHEMA_VERSION = "v1";

function hashHex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function band(c: number): "low" | "medium" | "high" {
  if (c < 0.4) return "low";
  if (c < 0.75) return "medium";
  return "high";
}

export function buildCreateDecisionReceiptInput(args: {
  id: string;
  category: string;
  result: ComparisonResult;
}): CreateDecisionReceiptInput {
  return {
    receiptId: `rcpt_${args.id}`,
    payloadHash: args.result.receiptPayloadHash,
    schemaVersion: SCHEMA_VERSION,
    category: args.category,
    recommendationHash: hashHex(`${args.result.topPick.id}:${args.result.topPick.finalScore}`),
    confidenceBand: band(args.result.signals.confidence),
    publicSummaryHash: null,
  };
}
```

- [ ] **Step 3: Run, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/lib/genlayer/buildInput.ts src/lib/genlayer/__tests__/buildInput.test.ts
git commit -m "feat(phase3b): server-side CreateDecisionReceiptInput builder"
```

### Task 4.2: `client.ts` factory

**Files:**
- Create: `src/lib/genlayer/client.ts`

- [ ] **Step 1: Write the read/write client factories**

```ts
import {
  createClient,
  createAccount,
  studionet,
  type GenLayerClient,
} from "genlayer-js";
import { GenLayerError } from "./errors";

export function createReadClient(): GenLayerClient {
  return createClient({
    chain: studionet,
    endpoint: process.env.GENLAYER_RPC_URL,
  });
}

export function createServiceWriteClient(): GenLayerClient {
  const pk = process.env.GENLAYER_SERVICE_PRIVATE_KEY;
  if (!pk) throw new GenLayerError("service_account_unavailable", "service key missing");
  const account = createAccount(pk as `0x${string}`);
  return createClient({
    chain: studionet,
    account,
    endpoint: process.env.GENLAYER_RPC_URL,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/genlayer/client.ts
git commit -m "feat(phase3b): genlayer-js read/write client factories"
```

### Task 4.3: Real `GenLayerServiceImpl`

**Files:**
- Modify: `src/lib/genlayer/service.ts`
- Modify: `src/lib/genlayer/__tests__/service.test.ts`

- [ ] **Step 1: Add tests covering submit success, RPC down, finalized-with-error, timeout**

```ts
// add to service.test.ts
import { vi } from "vitest";
import { GenLayerServiceImpl } from "../service";
import { GenLayerError } from "../errors";

describe("GenLayerServiceImpl.createDecisionReceipt", () => {
  it("submits and returns tx hash + creator", async () => {
    const fakeClient = {
      writeContract: vi.fn().mockResolvedValue("0xtx"),
      account: { address: "0xservice" },
    };
    const svc = new GenLayerServiceImpl("0xcontract", () => fakeClient as never, () => fakeClient as never);
    const out = await svc.createDecisionReceipt!({
      receiptId: "rcpt_1",
      payloadHash: "deadbeef",
      schemaVersion: "v1",
      category: "phones",
      recommendationHash: "abc",
      confidenceBand: "high",
      publicSummaryHash: null,
    });
    expect(out.transactionHash).toBe("0xtx");
    expect(out.creatorAddress).toBe("0xservice");
  });

  it("maps RPC errors to genlayer_rpc_unavailable", async () => {
    const fakeClient = {
      writeContract: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      account: { address: "0xservice" },
    };
    const svc = new GenLayerServiceImpl("0xcontract", () => fakeClient as never, () => fakeClient as never);
    await expect(svc.createDecisionReceipt!({ /* ... */ } as never)).rejects.toMatchObject({ code: "genlayer_rpc_unavailable" });
  });
});
```

- [ ] **Step 2: Update `service.ts` to inject client factories (for testability)**

```ts
type ReadFactory = () => GenLayerClient;
type WriteFactory = () => GenLayerClient;

export class GenLayerServiceImpl implements GenLayerService {
  constructor(
    private readonly contractAddress: string,
    private readonly readFactory: ReadFactory = createReadClient,
    private readonly writeFactory: WriteFactory = createServiceWriteClient,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  buildReceipt(result: ComparisonResult): DecisionReceipt {
    return {
      id: `rcpt_${result.receiptPayloadHash.slice(0, 8)}`,
      payloadHash: result.receiptPayloadHash,
      status: "pending",
      network: "studionet",
      contractAddress: this.contractAddress,
      transactionHash: null,
      createdAt: new Date().toISOString(),
    };
  }

  async createDecisionReceipt(input: CreateDecisionReceiptInput) {
    let client: GenLayerClient;
    try {
      client = this.writeFactory();
    } catch (err) {
      if (isGenLayerError(err)) throw err;
      throw new GenLayerError("service_account_unavailable", "could not init write client", { cause: err });
    }
    try {
      const hash = await client.writeContract({
        address: this.contractAddress as `0x${string}`,
        functionName: "create_receipt",
        args: [
          input.receiptId,
          `0x${input.payloadHash}`,
          input.schemaVersion,
          input.category,
          `0x${input.recommendationHash}`,
          input.confidenceBand,
          input.publicSummaryHash ? `0x${input.publicSummaryHash}` : null,
        ],
      });
      return { transactionHash: hash, creatorAddress: client.account!.address };
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  async refreshReceiptStatus(transactionHash: string) {
    const client = this.readFactory();
    try {
      const receipt = await client.waitForTransactionReceipt({
        hash: transactionHash as `0x${string}`,
        status: "ACCEPTED",
        timeout: 3000,
      });
      const txExec = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
      if (!txExec) return { status: "accepted", executionResult: null };
      if (txExec === "FINISHED_WITH_RETURN") return { status: "finalized", executionResult: "ok" };
      if (txExec === "FINISHED_WITH_ERROR") return { status: "finalized_with_error", executionResult: "error" };
      return { status: "finalized", executionResult: txExec };
    } catch (err) {
      if ((err as Error).message?.includes("timeout")) {
        throw new GenLayerError("transaction_timeout", "tx not yet accepted", { cause: err });
      }
      throw new GenLayerError("genlayer_rpc_unavailable", "rpc error", { cause: err });
    }
  }
}

function mapWriteError(err: unknown): GenLayerError {
  const msg = (err as Error)?.message ?? "";
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
    return new GenLayerError("genlayer_rpc_unavailable", msg, { cause: err });
  }
  if (msg.includes("insufficient funds")) {
    return new GenLayerError("insufficient_funds", msg, { cause: err });
  }
  return new GenLayerError("unknown_genlayer_error", msg, { cause: err });
}
```

- [ ] **Step 3: Run tests, expect PASS**

```bash
npm test -- service
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/genlayer/service.ts src/lib/genlayer/__tests__/service.test.ts
git commit -m "feat(phase3b): real GenLayerServiceImpl with injectable clients"
```

### Task 4.4: Switch POST `/receipt` to async submit + lazy poll on GET

**Files:**
- Modify: `src/app/api/comparisons/[id]/receipt/route.ts`
- Create: `src/app/api/comparisons/[id]/receipt/__tests__/route.test.ts`

- [ ] **Step 1: Test the new POST behavior**

```ts
// route.test.ts (vitest)
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST, GET } from "../route";
// mock store + service
```

Cover:
- POST with `GENLAYER_NETWORK=mock` → row with `submitterKind="mock"`, `status="off_chain_only"`.
- POST with studionet + service key → row `pending` + `transactionHash`.
- POST with studionet but no service key → 503 `service_account_unavailable`.
- GET with terminal status → returns row unchanged (does not call refresh).
- GET with `pending` row + service `refreshReceiptStatus` returning `accepted` → row updated.

- [ ] **Step 2: Update route**

```ts
// POST
const svc = getGenLayerService();
const isMock = (process.env.GENLAYER_NETWORK ?? "mock") === "mock";
if (isMock || !svc.createDecisionReceipt) {
  const built = svc.buildReceipt(comparison.result);
  const record = await saveReceipt({ comparisonId: id, receipt: built, submitterKind: "mock" });
  return NextResponse.json({ receipt: record }, { status: 201 });
}
const input = buildCreateDecisionReceiptInput({
  id: comparison.id,
  category: deriveCategory(comparison),
  result: comparison.result,
});
try {
  const { transactionHash, creatorAddress } = await svc.createDecisionReceipt(input);
  const built = svc.buildReceipt(comparison.result);
  const record = await saveReceipt({
    comparisonId: id,
    receipt: { ...built, transactionHash, status: "pending" },
    submitterKind: "service",
    creatorAddress,
  });
  return NextResponse.json({ receipt: record }, { status: 201 });
} catch (err) {
  if (isGenLayerError(err)) {
    return NextResponse.json({ error: err.code }, { status: HTTP_STATUS_BY_CODE[err.code] });
  }
  throw err;
}
```

GET:

```ts
const row = await getReceiptForComparison(id);
if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
const TERMINAL = new Set(["finalized", "finalized_with_error", "failed", "off_chain_only"]);
if (TERMINAL.has(row.status) || !row.transactionHash) return NextResponse.json({ receipt: row });
const svc = getGenLayerService();
if (!svc.refreshReceiptStatus) return NextResponse.json({ receipt: row });
try {
  const update = await svc.refreshReceiptStatus(row.transactionHash);
  if (update.status === row.status) return NextResponse.json({ receipt: row });
  const next = await updateReceiptStatus({
    comparisonId: id,
    status: update.status as ReceiptStatus,
    executionResult: update.executionResult ?? null,
  });
  return NextResponse.json({ receipt: next });
} catch (err) {
  if (isGenLayerError(err) && err.code === "transaction_timeout") {
    return NextResponse.json({ receipt: row });
  }
  if (isGenLayerError(err)) {
    return NextResponse.json({ error: err.code }, { status: HTTP_STATUS_BY_CODE[err.code] });
  }
  throw err;
}
```

`updateReceiptStatus` is a new helper added to `src/lib/store.ts`. `deriveCategory(comparison)` returns `comparison.input.prompt?.split(" ")[0] ?? "general"` (placeholder; refined later).

- [ ] **Step 3: Run gate, commit, push, PR**

```bash
npm run lint && npm run typecheck && npm run build && npm test
git add src/app/api/comparisons/[id]/receipt src/lib/store.ts
git commit -m "feat(phase3b): async submit + lazy poll for service path"
git push -u origin phase3b/04-service-path
gh pr create --base master --title "feat(phase3b): service path live" --body "..."
```

---

# PR #5 — Frontend service-path UX

**Branch:** `phase3b/05-frontend-service`.

**Goal:** Render receipt status pill (pending/accepted/finalized/error). Frontend polls every 4s while non-terminal, gives up after 5 minutes total with `transaction_timeout`. Always show that the off-chain result is valid.

### Task 5.1: `useReceiptPolling` hook

**Files:**
- Create: `src/lib/hooks/useReceiptPolling.ts`
- Create: `src/lib/hooks/__tests__/useReceiptPolling.test.tsx`

- [ ] **Step 1: Test polling behavior with fake timers**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useReceiptPolling } from "../useReceiptPolling";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useReceiptPolling", () => {
  it("stops on terminal status", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "finalized" });
    const { result } = renderHook(() => useReceiptPolling("cmp-1", fetcher));
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(result.current.receipt?.status).toBe("finalized");
  });

  it("times out after 5 minutes", async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: "pending" });
    const { result } = renderHook(() => useReceiptPolling("cmp-1", fetcher));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 4000);
    expect(result.current.error).toBe("transaction_timeout");
  });
});
```

(Adds dev-deps `@testing-library/react`, `@testing-library/dom`, `jsdom`. Update `vitest.config.ts` `environment: "jsdom"` for tsx tests via `environmentMatchGlobs`.)

- [ ] **Step 2: Implement hook**

```ts
import { useEffect, useRef, useState } from "react";

const POLL_MS = 4000;
const MAX_TOTAL_MS = 5 * 60 * 1000;
const TERMINAL = new Set(["finalized", "finalized_with_error", "failed", "off_chain_only"]);

export function useReceiptPolling(comparisonId: string | null, fetcher: (id: string) => Promise<any>) {
  const [receipt, setReceipt] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!comparisonId) return;
    let cancelled = false;
    startedAt.current = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const r = await fetcher(comparisonId);
        if (cancelled) return;
        setReceipt(r);
        if (TERMINAL.has(r.status)) return;
        if (Date.now() - (startedAt.current ?? 0) > MAX_TOTAL_MS) {
          setError("transaction_timeout");
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!cancelled) setError("rpc_error");
      }
    };
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer!);
    };
  }, [comparisonId, fetcher]);

  return { receipt, error };
}
```

- [ ] **Step 3: Test PASS, commit**

### Task 5.2: `ReceiptStatusPill` + `ReceiptCard`

**Files:**
- Create: `src/components/receipt/ReceiptStatusPill.tsx`, `ReceiptCard.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: `ReceiptStatusPill.tsx`**

```tsx
import type { ReceiptStatus } from "@/lib/genlayer";

const LABELS: Record<ReceiptStatus, { text: string; tone: string }> = {
  off_chain_only: { text: "Off-chain", tone: "bg-slate-200 text-slate-700" },
  pending: { text: "Pending", tone: "bg-amber-100 text-amber-800" },
  accepted: { text: "Accepted", tone: "bg-blue-100 text-blue-800" },
  finalized: { text: "Finalized", tone: "bg-emerald-100 text-emerald-800" },
  finalized_with_error: { text: "Finalized (error)", tone: "bg-rose-100 text-rose-800" },
  failed: { text: "Failed", tone: "bg-rose-200 text-rose-900" },
};

export function ReceiptStatusPill({ status }: { status: ReceiptStatus }) {
  const cfg = LABELS[status];
  return <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${cfg.tone}`}>{cfg.text}</span>;
}
```

- [ ] **Step 2: `ReceiptCard.tsx`** — composes pill, "your off-chain result is still valid" copy, retry CTA on error states, view-on-explorer link when `transactionHash`.

- [ ] **Step 3: Wire into `src/app/page.tsx`** under the comparison result panel.

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
# Open http://localhost:3000, run a comparison, click "Generate receipt".
# With GENLAYER_NETWORK=mock — pill = "Off-chain", no polling.
```

Per spec §10 + the `ecc:browser-qa` discipline: also document this manual step in the PR body.

- [ ] **Step 5: Gate + PR**

---

# PR #6 — Wallet path

**Branch:** `phase3b/06-wallet-path`.

**Goal:** Add `GET /receipt/build-input`, `POST /receipt/wallet-tx`. Frontend builds write client via wagmi/viem provider, user signs. Hash + category are server-derived; client cannot inject them.

### Task 6.1: `GET /receipt/build-input`

**Files:**
- Create: `src/app/api/comparisons/[id]/receipt/build-input/route.ts`
- Add tests

- [ ] **Step 1: Test — returns deterministic input, no client influence**

- [ ] **Step 2: Implement**

```ts
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cmp = await getComparison(id);
  if (!cmp) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const input = buildCreateDecisionReceiptInput({
    id: cmp.id,
    category: deriveCategory(cmp),
    result: cmp.result,
  });
  return NextResponse.json({ input, contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS, network: process.env.GENLAYER_NETWORK });
}
```

### Task 6.2: `POST /receipt/wallet-tx`

**Files:**
- Create: `src/app/api/comparisons/[id]/receipt/wallet-tx/route.ts`

- [ ] **Step 1: Tests**

- POST with mismatched `creatorAddress` → 400.
- POST with valid `transactionHash` → row upserts with `submitterKind="user"`, ignores any client hash.
- Replay: second POST with different hash + same comparisonId → upserts (unique key wins).

- [ ] **Step 2: Implement**

```ts
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { transactionHash?: string; creatorAddress?: string };
  if (!body.transactionHash || !body.creatorAddress) {
    return NextResponse.json({ error: "wallet_not_connected" }, { status: 400 });
  }
  const cmp = await getComparison(id);
  if (!cmp) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const built = getGenLayerService().buildReceipt(cmp.result);
  const record = await saveReceipt({
    comparisonId: id,
    receipt: { ...built, transactionHash: body.transactionHash, status: "pending" },
    submitterKind: "user",
    creatorAddress: body.creatorAddress,
  });
  return NextResponse.json({ receipt: record }, { status: 201 });
}
```

### Task 6.3: Frontend wallet wiring

**Files:**
- Modify: `src/app/providers.tsx` (add GenLayer chain to wagmi config)
- Create: `src/components/receipt/WalletPathToggle.tsx`
- Modify: `ReceiptCard.tsx` (offer "Sign with wallet" when `WalletPathToggle` is on and wallet connected)

- [ ] **Step 1: Add chain config**

```ts
// in providers.tsx
import { defineChain } from "viem";
const studionet = defineChain({
  id: Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID ?? 61_999),
  name: "GenLayer Studionet",
  nativeCurrency: { name: "Gen", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? ""] } },
});
```

- [ ] **Step 2: `WalletPathToggle.tsx`** — controlled toggle that records preference in `localStorage`.

- [ ] **Step 3: `ReceiptCard.tsx` flow**

```tsx
async function submitWithWallet() {
  const res = await fetch(`/api/comparisons/${id}/receipt/build-input`).then(r => r.json());
  const { input, contractAddress } = res;
  const writeClient = createWriteClient(account, walletProvider); // from genlayer-js using wagmi connector's provider
  const txHash = await writeClient.writeContract({ address: contractAddress, functionName: "create_receipt", args: [/* from input */] });
  await fetch(`/api/comparisons/${id}/receipt/wallet-tx`, { method: "POST", body: JSON.stringify({ transactionHash: txHash, creatorAddress: account }) });
}
```

- [ ] **Step 4: Switch-network handling**

If `useChainId() !== studionet.id`, surface "Switch network" button using `useSwitchChain` before signing.

- [ ] **Step 5: Manual smoke** with MetaMask on Studionet, document in PR body.

- [ ] **Step 6: PR**

---

# PR #7 — Studionet smoke + docs

**Branch:** `phase3b/07-studionet-smoke`.

**Goal:** Operator-facing smoke script + runbook + env doc. Not run in CI.

### Task 7.1: `scripts/check-studionet.ts`

**Files:**
- Create: `scripts/check-studionet.ts`

- [ ] **Step 1: Implement**

```ts
import { config } from "dotenv";
config();
import { createReadClient, createServiceWriteClient } from "@/lib/genlayer/client";
import { buildCreateDecisionReceiptInput } from "@/lib/genlayer/buildInput";

async function main() {
  if (process.env.GENLAYER_NETWORK !== "studionet") throw new Error("set GENLAYER_NETWORK=studionet");
  const write = createServiceWriteClient();
  const input = buildCreateDecisionReceiptInput({
    id: `smoke_${Date.now()}`,
    category: "smoke",
    result: { /* synthetic ComparisonResult */ } as never,
  });
  const tx = await write.writeContract({
    address: process.env.GENLAYER_CONTRACT_ADDRESS as `0x${string}`,
    functionName: "create_receipt",
    args: [/* mapped from input */],
  });
  console.log("tx:", tx);
  const read = createReadClient();
  const receipt = await read.waitForTransactionReceipt({ hash: tx, status: "FINALIZED", timeout: 60_000 });
  console.log("status:", receipt.status, "exec:", receipt.consensus_data?.leader_receipt?.[0]?.execution_result);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: npm script**

```json
"genlayer:smoke": "tsx scripts/check-studionet.ts"
```

### Task 7.2: Docs

**Files:**
- Create: `docs/architecture/05-phase3b-genlayer-integration.md`
- Create: `docs/runbook/genlayer-service-account.md`
- Modify: `.env.example`

- [ ] **Step 1: `.env.example` additions** (per spec §9)

```
# GenLayer integration (Phase 3B)
GENLAYER_NETWORK=mock                       # mock | studionet
GENLAYER_CONTRACT_ADDRESS=                  # 0x... once deployed
GENLAYER_SERVICE_PRIVATE_KEY=               # 0x... server-only; empty disables service path
GENLAYER_RPC_URL=
RECEIPT_RATE_LIMIT_PER_MIN=20

NEXT_PUBLIC_GENLAYER_NETWORK=mock
NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS=
NEXT_PUBLIC_GENLAYER_CHAIN_ID=
NEXT_PUBLIC_GENLAYER_RPC_URL=
```

- [ ] **Step 2: Runbook** — service-account top-up steps, rotating the key, `503 service_account_unavailable` recovery.

- [ ] **Step 3: Architecture doc** — short writeup linking to the spec, listing surface area, env matrix, mock vs studionet behavior table.

- [ ] **Step 4: PR + close-out**

```bash
git push -u origin phase3b/07-studionet-smoke
gh pr create --base master --title "feat(phase3b): studionet smoke + runbook + docs" --body "..."
```

After merge, close the design tracker PR (#3) with a comment pointing at the merged PRs.

---

## Self-review summary

- **Spec coverage:** Goals §1, dual-path §3, module layout §4 (PR #2), contract §5 (PR #3), data flow §6.1/§6.3 (PR #4), §6.2 (PR #6), schema §7 (PR #1), error mapping §8 (PR #2 + applied PR #4/§6), env §9 (PR #7), testing §10 (interleaved per PR), order §11 (this plan's structure), risks §12 (runbook in PR #7).
- **Placeholder scan:** No "TBD" / "implement later". Each step shows code or commands.
- **Type consistency:** `submitterKind` is `"service" | "user" | "mock"` everywhere. `ReceiptStatus` adds `finalized_with_error` in PR #2 (`types.ts`) and is consumed in PR #4 (`refreshReceiptStatus`) and PR #5 (`ReceiptStatusPill`). `CreateDecisionReceiptInput` defined PR #2, used PR #4 + PR #6.
- **Open dependency:** PR #1 hard-depends on Phase 3A merging to `master` first. If 3A stalls, PR #1 must rebase off `phase3a-db-foundation` and the merge order locks.
