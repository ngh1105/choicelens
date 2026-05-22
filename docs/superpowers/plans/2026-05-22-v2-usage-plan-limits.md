# ChoiceLens V2 Usage + Plan Limits — Implementation Plan

Date: 2026-05-22
Status: draft, awaiting approval to implement
Branch (docs): `codex/v2-usage-plan-limits-design`
Branch (impl, future): `codex/v2-usage-plan-limits`
Spec: [`docs/superpowers/specs/2026-05-22-v2-usage-plan-limits-design.md`](../specs/2026-05-22-v2-usage-plan-limits-design.md)

This plan implements V2 slice 1: derived usage tracking plus hard Free-plan
server gates. It does not add Stripe, auth, checkout, pricing, queues, or a
usage ledger.

---

## 0. Preconditions

- Spec is reviewed and accepted.
- Implementation branch starts from current `master` after the docs/design work
  lands or is intentionally cherry-picked.
- Local database is reachable for Prisma migration/test work.
- Existing gates are green on the starting branch:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`

If the database is unavailable locally, complete docs/code work but stop before
running migration-dependent verification and report the blocker.

## 1. Branch Strategy

- Docs/design branch: `codex/v2-usage-plan-limits-design`.
- Implementation branch: `codex/v2-usage-plan-limits`.
- Keep the existing untracked note
  `docs/superpowers/plans/2026-05-21-ui-refresh-followup.md` unmodified unless
  the user explicitly asks to remove or commit it.
- Use small commits by task. Do not squash locally.

## 2. File Scope

Expected files:

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `User.plan` |
| `prisma/migrations/**/migration.sql` | Add migration for `User.plan` |
| `src/lib/plans.ts` | New static plan catalog |
| `src/lib/usage.ts` | New derived usage service and limit helpers |
| `src/lib/__tests__/plans.test.ts` | New plan catalog tests |
| `src/lib/__tests__/usage.test.ts` | New usage/limit tests |
| `src/app/api/usage/route.ts` | New usage summary endpoint |
| `src/app/api/usage/__tests__/route.test.ts` | New API test |
| `src/app/api/comparisons/route.ts` | Enforce comparison limit |
| `src/app/api/comparisons/__tests__/route.test.ts` | New comparison limit tests |
| `src/app/api/comparisons/[id]/watchlist/route.ts` | Enforce watchlist limit |
| `src/app/api/comparisons/[id]/watchlist/__tests__/route.test.ts` | New watchlist limit tests |
| `src/app/api/comparisons/[id]/receipt/route.ts` | Enforce service/mock receipt limit |
| `src/app/api/comparisons/[id]/receipt/wallet-tx/route.ts` | Enforce wallet receipt limit |
| Existing route tests under `src/app/api/**/__tests__` | Add limit cases |
| `src/app/page.tsx` | Fetch/render usage, disable relevant actions |
| `src/app/globals.css` | Usage meter/panel styles |

Avoid touching GenLayer service internals, comparison scoring, store data shape
except where needed for idempotency checks, and unrelated UI polish.

## 3. Step-By-Step Implementation

### Step 1 — Schema And Prisma Migration

Files:

- Modify `prisma/schema.prisma`
- Add `prisma/migrations/<timestamp>_add_user_plan/migration.sql`

Tasks:

- Add `plan String @default("free")` to `User`.
- Generate a migration with Prisma if the local database is available:
  `npx prisma migrate dev --name add_user_plan`.
- If the local database is unavailable, create the migration SQL manually:

```sql
ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
```

- Run `npx prisma generate`.

Acceptance:

- Prisma Client generation succeeds.
- Existing users default to `free`.
- No other schema changes appear.

Commit:

```bash
git add prisma/schema.prisma prisma/migrations package-lock.json package.json
git commit -m "feat(plans): add user plan field"
```

Only include `package*.json` if Prisma changes them.

### Step 2 — Plan Catalog

Files:

- Add `src/lib/plans.ts`
- Add `src/lib/__tests__/plans.test.ts`

Tasks:

- Define `PlanId = "free" | "plus" | "pro"`.
- Define limit models:
  - Free: 20 comparisons/month, 10 active watchlist items, 5 receipts/month.
  - Plus: unlimited (`null`) for all three features.
  - Pro: unlimited (`null`) for all three features.
- Export helpers:
  - `resolvePlanId(value: string | null | undefined): PlanId`
  - `getPlanDefinition(value: string | null | undefined)`
  - `formatPlanLimitMessage(planId, feature, limit)`
- Unknown values fall back to Free.
- Tests cover known plans, unknown fallback, and Free limits.

Acceptance:

- `npx vitest run src/lib/__tests__/plans.test.ts` passes.

Commit:

```bash
git add src/lib/plans.ts src/lib/__tests__/plans.test.ts
git commit -m "feat(plans): add static plan catalog"
```

### Step 3 — Derived Usage Service

Files:

- Add `src/lib/usage.ts`
- Add `src/lib/__tests__/usage.test.ts`
- Modify `src/lib/db.ts` if a current-user helper needs to expose plan.

Tasks:

- Add types:
  - `UsageFeature = "comparisons" | "watchlist" | "receipts"`
  - `UsageMetric`
  - `UsageSummary`
  - `PlanLimitError`
- Compute UTC month window:
  - start: first day of current UTC month at `00:00:00.000Z`
  - reset: first day of next UTC month at `00:00:00.000Z`
- Implement `getUsageSummary(now = new Date())`.
- Implement `assertWithinPlanLimit(feature, options)` or equivalent helper
  that throws a typed `PlanLimitError` when blocked.
- Count:
  - comparisons: `prisma.comparison.count({ where: { userId, createdAt: { gte: start, lt: reset } } })`
  - receipts: join through comparison ownership or query receipt with
    comparison user relation and `createdAt` month window.
  - watchlist: active rows by `userId` with no month filter.
- Clamp remaining to `0` when used exceeds limit.
- Treat `null` limits as unlimited: `remaining: null`, `blocked: false`.

Idempotency support:

- Add helpers routes can call before gating:
  - `hasWatchlistEntryForComparisonPayload(comparisonId)`
  - `hasReceiptForComparison(comparisonId)`
- These helpers must verify ownership through current user.

Tests:

- UTC month boundaries.
- Remaining never below zero.
- Watchlist is total active rows.
- Unlimited plans never block.
- Typed `PlanLimitError` includes feature, message, metric, and reset date.

Acceptance:

- `npx vitest run src/lib/__tests__/usage.test.ts` passes.

Commit:

```bash
git add src/lib/usage.ts src/lib/__tests__/usage.test.ts src/lib/db.ts
git commit -m "feat(usage): derive plan usage from records"
```

### Step 4 — Usage API Endpoint

Files:

- Add `src/app/api/usage/route.ts`
- Add `src/app/api/usage/__tests__/route.test.ts`

Tasks:

- Implement `GET /api/usage`.
- Return the stable response shape from the spec.
- On unexpected errors, log `GET /api/usage failed` and return
  `{ error: "internal_error" }` with `500`.
- Tests mock or seed usage counts consistently with existing route test style.

Acceptance:

- `npx vitest run src/app/api/usage/__tests__/route.test.ts` passes.

Commit:

```bash
git add src/app/api/usage
git commit -m "feat(api): expose plan usage summary"
```

### Step 5 — Server Gates

Files:

- Modify `src/app/api/comparisons/route.ts`
- Modify `src/app/api/comparisons/[id]/watchlist/route.ts`
- Modify `src/app/api/comparisons/[id]/receipt/route.ts`
- Modify `src/app/api/comparisons/[id]/receipt/wallet-tx/route.ts`
- Update existing route tests

Tasks:

- Add a shared `planLimitResponse(error)` helper, either in `src/lib/usage.ts`
  as a serializable payload builder or locally in each route with a common
  imported payload function.
- `POST /api/comparisons`:
  - Validate input first.
  - Gate `comparisons` before `runComparison` and `saveComparison`.
- `POST /api/comparisons/[id]/watchlist`:
  - Check whether the top-pick payload is already saved for this comparison.
  - If already saved, return existing behavior without gating.
  - Otherwise gate `watchlist` before insert.
- `POST /api/comparisons/[id]/receipt`:
  - Check whether the comparison already has a receipt.
  - If it exists, return it without consuming/gating a new credit.
  - Otherwise gate `receipts` before service/mock receipt creation.
- `POST /api/comparisons/[id]/receipt/wallet-tx`:
  - Validate request body as today.
  - Check existing receipt for comparison.
  - If it exists, return it without consuming/gating a new credit.
  - Otherwise gate `receipts` before save.
- Limit failures return HTTP `402` with:
  - `error: "plan_limit_reached"`
  - `feature`
  - `message`
  - `usage`
  - `resetAt`

Tests:

- Comparison at 19 succeeds; at 20 returns `402`.
- Watchlist at 10 blocks new save.
- Duplicate watchlist at 10 returns existing entry.
- Service/mock receipt at 5 blocks new receipt.
- Existing service/mock receipt at 5 returns existing receipt.
- Wallet receipt at 5 blocks new receipt.
- Existing wallet receipt at 5 returns existing receipt.

Acceptance:

- Targeted route tests pass:

```bash
npx vitest run "src/app/api/comparisons/__tests__/route.test.ts" "src/app/api/comparisons/[id]/watchlist/__tests__/route.test.ts" "src/app/api/comparisons/[id]/receipt/__tests__/route.test.ts" "src/app/api/comparisons/[id]/receipt/wallet-tx/__tests__/route.test.ts"
```

Commit:

```bash
git add src/app/api src/lib/usage.ts
git commit -m "feat(api): enforce free plan limits"
```

### Step 6 — Client Usage State

Files:

- Modify `src/app/page.tsx`

Tasks:

- Add `UsageSummary` client type matching `/api/usage`.
- On initial load, fetch `/api/usage` alongside comparisons and watchlist.
- Add `usage` and `usageError` state.
- Refresh usage after successful:
  - comparison create
  - watchlist save
  - watchlist remove
  - receipt build
  - wallet receipt submit
- Refresh usage after any `plan_limit_reached` response.
- Extend `ApiRequestError` handling to preserve response error code, feature,
  and message.
- Add a helper that maps `plan_limit_reached` to friendly user copy.

Acceptance:

- Under-limit behavior remains unchanged.
- Existing load error behavior still works if `/api/comparisons` or
  `/api/watchlist` fails.
- If `/api/usage` alone fails, the core app remains usable and the usage panel
  hides.

Commit:

```bash
git add src/app/page.tsx
git commit -m "feat(ui): load plan usage state"
```

### Step 7 — Usage UI And Action Disables

Files:

- Modify `src/app/page.tsx`
- Modify `src/app/globals.css`

Tasks:

- Add a header pill showing:
  - `Free plan`
  - `N comparisons left` when usage is available.
- Add a right-rail `UsagePanel` above or below `WatchlistPanel`.
- Show rows:
  - Comparisons: `used / limit`, reset date.
  - Watchlist: `used / limit`.
  - Receipts: `used / limit`, reset date.
- Style with existing panel, pill, bar, and mono conventions.
- Disable:
  - Run comparison when comparison limit is reached.
  - Save to watchlist when watchlist limit is reached and the result is not
    already saved.
  - Build receipt when receipt limit is reached and no receipt exists.
  - Wallet receipt controls when receipt limit is reached and no receipt exists.
- Render explanatory copy:
  - `Paid plan upgrades are coming soon.`
- Do not add an upgrade button, pricing route, modal, or checkout CTA.

Acceptance:

- Text fits at mobile widths.
- No layout overlap in the right rail.
- Disabled states explain why through nearby copy or button title/aria label.

Commit:

```bash
git add src/app/page.tsx src/app/globals.css
git commit -m "feat(ui): show free plan usage limits"
```

### Step 8 — Frontend Tests

Files:

- Add or update component/page tests under the existing test structure.

Tasks:

- Add focused tests for:
  - Usage panel renders Free limits.
  - Comparison limit disables Run comparison.
  - Watchlist limit disables Save only when current result is not already saved.
  - Receipt limit disables Build receipt only when no receipt exists.
  - `plan_limit_reached` response maps to friendly copy.

If `src/app/page.tsx` is not currently practical to test as a whole, extract
small pure helpers for limit mapping and action-disable calculation and test
those helpers instead. Keep extraction minimal.

Acceptance:

- Targeted frontend tests pass.

Commit:

```bash
git add src/app/page.tsx src/app/globals.css src/**/*.test.ts src/**/*.test.tsx
git commit -m "test(ui): cover usage limit states"
```

### Step 9 — Full Verification

Run:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Then local smoke with database available:

1. `npm run dev`
2. Open `/`.
3. Confirm usage pill and panel render.
4. Create a comparison below the limit; usage increments.
5. Save/remove watchlist; usage updates.
6. Build a receipt below the limit; usage increments.
7. Seed or mock near-limit data and verify disabled/action error behavior.
8. Open `/api/usage`; JSON shape matches spec.

Stop the dev server before final report.

Acceptance:

- All gates pass.
- Local smoke passes or any DB/env blocker is documented precisely.
- Working tree has only intended tracked changes plus the pre-existing
  untracked UI follow-up note if it is still present.

Commit:

No commit if only verification was run. If verification reveals fixes, commit
them with the narrowest applicable message.

## 4. Final PR Checklist

- Push `codex/v2-usage-plan-limits`.
- Open PR titled `feat(v2): add usage-based plan limits`.
- PR body includes:
  - Summary of Free limits.
  - API changes (`GET /api/usage`, `402 plan_limit_reached`).
  - Migration note for `User.plan`.
  - Test plan output.
  - Explicit non-goals: no Stripe, no checkout.
- Wait for CI.
- Merge only when green and reviewed/approved according to project practice.

## 5. Risk And Rollback

Risks:

- **Route gates block idempotent operations.**
  Mitigation: check existing watchlist/receipt before asserting limits.
- **Usage count race at the exact limit.**
  Mitigation: acceptable for this slice; future billing can add transactional
  usage ledger if real abuse appears.
- **Anonymous single-user limits affect demos globally.**
  Mitigation: limits are demo-friendly; local/prod data can be reset. Auth is
  intentionally out of scope.
- **Local DB unavailable blocks migration verification.**
  Mitigation: generate SQL manually and report that full DB verification needs
  a running Postgres.

Rollback:

- Revert the implementation PR to remove gates and UI usage surfaces.
- Keeping the nullable/defaulted `User.plan` column is harmless if rollback of
  the migration is undesirable.
- A full rollback migration can drop `User.plan` if needed:

```sql
ALTER TABLE "User" DROP COLUMN "plan";
```

## 6. Definition Of Done

1. Free plan limits are enforced server-side for comparison, watchlist,
   service/mock receipt, and wallet receipt creation.
2. Existing watchlist and receipt operations remain idempotent at the limit.
3. `/api/usage` returns the stable usage payload.
4. UI shows Free usage and disables only affected actions.
5. Limit errors are friendly and actionable.
6. No Stripe, billing, auth, usage ledger, or GenLayer contract changes.
7. `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test` pass.
