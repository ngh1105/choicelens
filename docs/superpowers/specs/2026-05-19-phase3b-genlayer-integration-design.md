# Phase 3B — GenLayer Integration Beta — Design

Date: 2026-05-19
Status: approved
Branch: `phase3b-design`
Depends on: Phase 3A (Prisma data foundation, PR #2)

## 1. Goals

- Replace `MockGenLayerService` with a real `genlayer-js` client that submits receipts to a deployed `ChoiceLensDecisionRegistry` Intelligent Contract on **GenLayer Studionet**.
- Support **two signing paths** at the same time:
  - **Service path (default):** backend signs and submits with a server-held service account.
  - **Wallet path (opt-in):** when the user has a wallet connected, the frontend builds a write client and the user signs the transaction themselves.
- Use **async submit + lazy polling** so off-chain comparison results, watchlist, and UI are never blocked on GenLayer latency.
- Keep the mock service as the default for fresh checkouts and CI.

## 2. Non-goals

- Public testnet (Bradbury / Asimov) deployment — Studionet only for this phase.
- Watchlist re-evaluation jobs on chain.
- SIWE / wallet-based authentication.
- Production observability (metrics, dashboards, alerting).
- Cost caps and rate limits beyond a single hard `RECEIPT_RATE_LIMIT_PER_MIN` env knob.

## 3. Locked decisions

| Decision | Choice | Reason |
|---|---|---|
| Who signs | Both: service account default + optional user wallet | User explicitly chose "C". Lets web2 users get receipts without a wallet while keeping a web3-native path. |
| Network target | Studionet | Matches roadmap §4 "early integration". One-line swap to Bradbury later. |
| Submit pattern | Async + lazy poll on `GET /receipt` | Avoids long-running route handlers. Status state machine already documented in roadmap. |

## 4. Module layout

```
src/lib/genlayer/
  index.ts           re-exports
  client.ts          createReadClient(), createWriteClient(account, provider)
  service.ts         GenLayerServiceImpl (real) + factory: getGenLayerService()
  mock.ts            MockGenLayerService (existing logic moves here)
  errors.ts          GenLayerError + normalized codes
  types.ts           submitter kinds, status enums
contracts/
  ChoiceLensDecisionRegistry.py   intelligent contract source
scripts/
  deploy-registry.ts              one-shot deploy via genlayer-js write client
  check-studionet.ts              integration smoke (gated by env)
prisma/migrations/                introduced this phase (replaces db push)
```

`src/lib/genlayer.ts` becomes a thin re-export of `src/lib/genlayer/index.ts` so existing imports (`import { getGenLayerService } from "@/lib/genlayer"`) keep working without churn.

`getGenLayerService()` selects implementation by `GENLAYER_NETWORK`:
- `mock` (default) → `MockGenLayerService`.
- `studionet` → `GenLayerServiceImpl`. Requires `GENLAYER_CONTRACT_ADDRESS`. Service path additionally requires `GENLAYER_SERVICE_PRIVATE_KEY`; if absent, only the wallet path works and POST `/receipt` returns `503 service_account_unavailable`.

## 5. Contract — `ChoiceLensDecisionRegistry`

Stored fields:

| Field | Type | Notes |
|---|---|---|
| `receipt_id` | `str` | App-generated id (mirrors DB row). |
| `creator` | `address` | Address that submitted the tx. |
| `payload_hash` | `bytes32` | FNV-1a-derived ChoiceLens hash, padded. Public-safe digest. |
| `schema_version` | `str` | App schema version, e.g. `"v1"`. Independent of contract version. |
| `category` | `str` | Public-safe label, e.g. `"smartphones"`. Caller-supplied; no PII. |
| `recommendation_hash` | `bytes32` | Hash of top pick id + final score. |
| `confidence_band` | `str` | `"low" \| "medium" \| "high"`. |
| `created_at` | `int` | Block timestamp. |
| `public_summary_hash` | `bytes32?` | Reserved; null until summary feature lands. |

Methods:

- `create_receipt(receipt_id, payload_hash, schema_version, category, recommendation_hash, confidence_band, public_summary_hash) -> str`
- `get_receipt(receipt_id) -> ReceiptStruct`
- `get_user_receipts(address) -> list[str]`

Excluded from chain: raw prompts, weights, option URLs, notes, watchlist details, payment data, identifiers.

## 6. Data flow

### 6.1 Service path (default, `submitter=service`)

1. Client `POST /api/comparisons/:id/receipt` with no body.
2. Backend loads `Comparison`, computes `CreateDecisionReceiptInput` from `comparison.result` (NEVER from client input).
3. `service.createDecisionReceipt(input)` builds a write client with the service account key and calls `create_receipt`.
4. On submit success, upsert `Receipt`:
   - `status = "pending"`
   - `submitterKind = "service"`
   - `creatorAddress = <service address>`
   - `transactionHash = <hash>`
   - `network = "studionet"`
   - `contractAddress = GENLAYER_CONTRACT_ADDRESS`
5. Respond `201 { receipt }`.

### 6.2 Wallet path (opt-in, `submitter=user`)

1. Frontend ensures wallet is connected and on the GenLayer chain (`useSwitchChain` if not).
2. Frontend fetches `GET /api/comparisons/:id/receipt/build-input` → backend returns the deterministic `CreateDecisionReceiptInput` derived from stored result. **The hash and category are server-derived; the client cannot supply them.**
3. Frontend builds a write client via `createWriteClient(address, walletProvider)` and submits `create_receipt(...)` with that input. User signs.
4. Frontend `POST /api/comparisons/:id/receipt/wallet-tx` with `{ transactionHash, creatorAddress }`.
5. Backend re-derives the same input from `comparison.result`. The client-supplied `creatorAddress` is recorded as a hint; the on-chain receipt's `creator` field is the source of truth and overwrites the row on next status refresh. Replay protection comes from the unique `(comparisonId)` constraint on `Receipt` plus the server-derived hash — a malicious client cannot bind a receipt to a different comparison or a different payload.
6. Backend upserts `Receipt` with `submitterKind = "user"`.

### 6.3 Status refresh (both paths)

`GET /api/comparisons/:id/receipt` rules:

- If row missing → 404.
- If `status` terminal (`finalized | finalized_with_error | failed | off_chain_only`) → return as-is.
- Else, with the read client, `waitForTransactionReceipt({ hash, status: ACCEPTED, timeout: 3000ms })`:
  - On timeout → return current row unchanged.
  - On `ACCEPTED` not yet `FINALIZED` → update `status = "accepted"`.
  - On `FINALIZED` → inspect `txExecutionResultName`:
    - `FINISHED_WITH_RETURN` → `status = "finalized"`, `executionResult = "ok"`.
    - `FINISHED_WITH_ERROR` → `status = "finalized_with_error"`, `executionResult = "error"`.
    - other → `status = "finalized"`, `executionResult = <name>`.
  - Persist and return.

Frontend polls every 4s while status is non-terminal. Stops after 5 minutes total → shows `transaction_timeout` error state with a manual retry.

## 7. Schema delta (Prisma)

Migration `0001_phase3b_receipt_fields`:

```prisma
model Receipt {
  id              String     @id
  comparisonId    String     @unique
  payloadHash     String
  status          String
  network         String
  submitterKind   String     // "service" | "user" | "mock"
  creatorAddress  String?
  contractAddress String?
  transactionHash String?
  executionResult String?    // "ok" | "error" | raw name
  errorCode       String?    // GenLayerError code if status=failed
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  comparison      Comparison @relation(fields: [comparisonId], references: [id], onDelete: Cascade)
}
```

Workflow change: introduce `prisma/migrations/`. `db:reset` becomes `prisma migrate reset --force` (now safe — migrations exist). `db:push` script removed from `package.json` to prevent accidental drift; doc tells contributors to use `prisma migrate dev`.

The existing `db.ts` `getDefaultUserId()` cache is unchanged.

## 8. Error handling

`src/lib/genlayer/errors.ts`:

```ts
type GenLayerErrorCode =
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
```

API HTTP mapping:

| Code | HTTP |
|---|---|
| `wallet_rejected`, `wallet_not_connected` | 400 |
| `wrong_network`, `contract_schema_mismatch` | 409 |
| `service_account_unavailable`, `genlayer_rpc_unavailable`, `contract_not_configured` | 503 |
| `transaction_timeout`, `transaction_failed`, `receipt_not_finalized` | 502 |
| `insufficient_funds`, `unknown_genlayer_error` | 500 |

UI rules:
- Always surface what happened.
- Always remind the user the off-chain result is still valid.
- Service-path errors offer "retry"; wallet-path errors include "switch to service path" if available.

## 9. Environment

`.env.example` additions:

```
# GenLayer integration (Phase 3B)
GENLAYER_NETWORK=mock                       # mock | studionet
GENLAYER_CONTRACT_ADDRESS=                  # 0x... once deployed
GENLAYER_SERVICE_PRIVATE_KEY=               # 0x... server-only; empty disables service path
RECEIPT_RATE_LIMIT_PER_MIN=20

# Frontend-visible mirrors
NEXT_PUBLIC_GENLAYER_NETWORK=mock
NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS=
NEXT_PUBLIC_GENLAYER_CHAIN_ID=              # set when wallet path is used
```

Service key is read **only** in server-side modules. Linter check (or runtime guard at boot) rejects accidental import from a `"use client"` file.

## 10. Testing

Unit:
- `GenLayerServiceImpl` against a stub `genlayer-js` client covering: submit success, RPC down, finalized-with-error, timeout, wrong network.
- Mock service still passes the existing `GenLayerService` interface tests.
- Server-derived `CreateDecisionReceiptInput` is deterministic for a given `ComparisonResult`.

API integration (against mock + a local SQLite DB):
- POST `/receipt` (service path) → row created with `submitterKind="mock"` and terminal status `off_chain_only`.
- POST `/receipt/wallet-tx` rejects mismatched `creatorAddress`, accepts a valid one, ignores any client-supplied hash.
- GET `/receipt` advances state on stubbed pending → accepted → finalized.

Real network smoke (`scripts/check-studionet.ts`, gated by `GENLAYER_NETWORK=studionet`):
- Deploy or read existing contract.
- Submit one receipt with the service account.
- Poll until `accepted` or `finalized`.
- Print the on-chain receipt id and tx hash.

CI does not run the studionet script. CI runs lint, typecheck, build, and the mock-only integration tests.

## 11. Order of work

Each item targets ~one PR:

1. **Schema + migrations.** Introduce `prisma/migrations/0001_init` (snapshot of current schema) + `0002_phase3b_receipt_fields`. Update `db:reset`, `db:seed` to migrate workflow. Mock writes the new fields with `submitterKind="mock"`.
2. **GenLayer client + service skeleton.** `src/lib/genlayer/{client,service,errors,types}.ts`. Wire factory. Mock still default.
3. **Contract + deploy script.** `contracts/ChoiceLensDecisionRegistry.py`. `scripts/deploy-registry.ts`. Commit deployed address out-of-band, document.
4. **Service path live.** POST `/receipt` switches to real impl when `GENLAYER_NETWORK=studionet`. Lazy poll on GET.
5. **Frontend service-path UX.** Status pill (`pending` / `accepted` / `finalized` / error). 4-second poll, 5-minute total timeout.
6. **Wallet path.** `GET /receipt/build-input`, frontend write-client wiring, `POST /receipt/wallet-tx`, opt-in toggle in UI.
7. **Studionet smoke + docs.** `scripts/check-studionet.ts`, env documentation, runbook for service-account top-up.

Each PR ends green: `npm run lint && npm run typecheck && npm run build && npm run db:reset && npm test`.

## 12. Risks

- **Service account empty / out of gas.** Mitigation: GET `/receipt` exposes a clear `service_account_unavailable` state; admin runbook documents the faucet.
- **GenLayer SDK breaking change.** Mitigation: pin `genlayer-js@1.1.8`; bump intentionally.
- **Receipt row drift between mock and real.** Mitigation: same Prisma schema, same `submitterKind` field, same lazy-poll path. Mock just writes `mock` and stays terminal.
- **Replay via wallet-tx route.** Mitigation: server re-derives the payload hash; `Receipt.comparisonId` is unique so a second submit upserts the same row.
- **Schema mismatch between contract and app.** Mitigation: contract pins `schema_version` string; app refuses to read receipts where the version disagrees and surfaces `contract_schema_mismatch`.

## 13. Open questions for follow-up phases

- When auth lands, link `Receipt.creatorAddress` to a `User.wallet` row; allow looking up "all my receipts" by user.
- Public receipt page (read-only, shareable URL) — depends on `get_user_receipts` and a public-safe view model.
- Move studionet → public testnet — config-only swap, but the deploy script should re-run against the new chain.
