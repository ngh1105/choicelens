# ChoiceLens V2 Usage + Plan Limits — Design Spec

Date: 2026-05-22
Status: approved direction, awaiting implementation plan
Owner: project founder
Branch: `codex/v2-usage-plan-limits-design`

## 1. Goal

Start V2 with a small but real monetization backbone: plan-aware usage
tracking and server-enforced Free limits, without Stripe or paid checkout yet.

The selected approach is **derived usage with hard gates**. ChoiceLens already
stores the three things Free limits need:

- `Comparison.createdAt` for monthly comparison usage.
- `WatchlistEntry` rows for saved watchlist count.
- `Receipt.createdAt` for monthly receipt usage.

V2 slice 1 computes usage from these source-of-truth records instead of
adding a separate usage ledger. This keeps the first monetization step simple,
auditable, and hard to bypass through direct API calls.

## 2. Selected Free Limits

Demo-friendly Free limits:

| Feature | Limit | Window |
|---|---:|---|
| Comparisons | 20 | Calendar month |
| Watchlist items | 10 | Total active saved items |
| Receipts | 5 | Calendar month |

`Plus` and `Pro` may appear as named plans in code and UI copy, but this slice
does not sell or activate them. The default user remains on `free`.

## 3. Non-Goals

- No Stripe, checkout, customer portal, invoices, taxes, or webhooks.
- No real account/auth work beyond the current default anonymous user.
- No usage-event ledger.
- No new queue, worker, notification, or watchlist alert behavior.
- No affiliate monetization.
- No pricing page.
- No public API monetization.
- No changes to GenLayer contract behavior.

## 4. Current System Fit

The app currently uses a single default anonymous user:

- `src/lib/db.ts` creates or reuses `User(handle="anon")`.
- `src/lib/store.ts` scopes comparisons, watchlist entries, and receipts to
  that user.
- `POST /api/comparisons` creates comparison rows.
- `POST /api/comparisons/[id]/watchlist` saves the top pick.
- `POST /api/comparisons/[id]/receipt` creates service/mock receipts.
- `POST /api/comparisons/[id]/receipt/wallet-tx` records wallet-submitted
  receipt proofs.

This slice preserves that shape. It introduces plan and usage concepts
without requiring a broader identity redesign.

## 5. Data Model

Add plan metadata to `User`:

```prisma
model User {
  id        String   @id @default(cuid())
  handle    String   @unique
  plan      String   @default("free")
  createdAt DateTime @default(now())

  comparisons Comparison[]
  watchlist   WatchlistEntry[]
}
```

`plan` is deliberately a string, not a new relation, because V2 slice 1 has a
static internal plan catalog. A future billing phase can add Stripe customer and
subscription fields without changing this slice's public response shape.

No new tables are needed.

## 6. Plan Catalog

Create a small server-side plan catalog in `src/lib/plans.ts`:

```ts
export type PlanId = "free" | "plus" | "pro";

export interface PlanLimits {
  comparisonsPerMonth: number | null;
  watchlistItems: number | null;
  receiptsPerMonth: number | null;
}
```

Free limits are fixed to the selected demo-friendly values. `plus` and `pro`
exist only as internal plan ids for the future billing hand-off. They use
`null` limits, meaning unlimited, but this slice does not expose a way to
purchase or activate them.

Unknown stored plan values resolve to Free for safety.

## 7. Usage Computation

Create a usage service in `src/lib/usage.ts`, with functions that:

- Resolve the current user and plan.
- Compute the current calendar-month window in UTC.
- Count comparisons created in the window.
- Count receipts created in the window.
- Count active watchlist rows.
- Return used, limit, remaining, percent, and blocked status per feature.

The reset date is the first instant of the next UTC month. Example:

```ts
{
  plan: "free",
  resetAt: "2026-06-01T00:00:00.000Z",
  usage: {
    comparisons: { used: 7, limit: 20, remaining: 13, blocked: false },
    watchlist: { used: 2, limit: 10, remaining: 8, blocked: false },
    receipts: { used: 1, limit: 5, remaining: 4, blocked: false }
  }
}
```

Use derived counts only. Do not cache usage in this slice.

## 8. API Surface

Add:

- `GET /api/usage`

Response:

```json
{
  "plan": "free",
  "resetAt": "2026-06-01T00:00:00.000Z",
  "usage": {
    "comparisons": { "used": 7, "limit": 20, "remaining": 13, "blocked": false },
    "watchlist": { "used": 2, "limit": 10, "remaining": 8, "blocked": false },
    "receipts": { "used": 1, "limit": 5, "remaining": 4, "blocked": false }
  }
}
```

Enforce limits before mutating:

| Route | Gate |
|---|---|
| `POST /api/comparisons` | comparisons monthly limit |
| `POST /api/comparisons/[id]/watchlist` | watchlist active item limit |
| `POST /api/comparisons/[id]/receipt` | receipts monthly limit |
| `POST /api/comparisons/[id]/receipt/wallet-tx` | receipts monthly limit |

Limit response:

```json
{
  "error": "plan_limit_reached",
  "feature": "comparisons",
  "message": "Free plan includes 20 comparisons per month.",
  "usage": { "used": 20, "limit": 20, "remaining": 0, "blocked": true },
  "resetAt": "2026-06-01T00:00:00.000Z"
}
```

Use HTTP `402 Payment Required` for plan limits. The app is not taking payment
yet, but `402` makes the monetization boundary explicit and keeps it separate
from validation (`400`), auth (`401`), not found (`404`), and generic throttling
(`429`).

Idempotency rule: adding an already-saved watchlist item should still return
the existing entry even when the user is at the watchlist limit. The operation
does not increase usage.

Receipt rule: if a receipt already exists for a comparison, returning/upserting
that same one should not consume an additional receipt credit. The receipt gate
applies only when the comparison does not already have a receipt.

## 9. UI Design

Add a compact usage surface to the existing calm premium workspace:

- Header pill: `Free plan` plus one concise meter, for example
  `13 comparisons left`.
- Right rail panel or panel section: usage rows for comparisons, watchlist, and
  receipts with used/limit and reset date.
- Near-action copy:
  - Compare button disabled only when the comparison limit is reached.
  - Save to watchlist button disabled only when watchlist limit is reached and
    the current result is not already saved.
  - Build receipt button disabled only when receipt limit is reached and the
    comparison has no existing receipt.
- API limit errors render in the existing `actionError` surface with friendly
  copy.

Do not add a pricing page or checkout CTA. Render plain explanatory copy when a
limit is reached: "Paid plan upgrades are coming soon." Do not render an
interactive upgrade button in this slice.

## 10. Error Handling

Add a typed plan-limit error path in server code so routes do not duplicate
JSON construction.

Client behavior:

- Treat `plan_limit_reached` as an actionable user-facing state, not an
  `internal_error`.
- Refresh usage after successful mutations and after a limit response.
- If `/api/usage` fails, hide the meter and keep core V1 behavior available
  until a mutating route returns a hard server response.

## 11. Testing Strategy

Unit tests:

- Plan catalog resolves known plans and falls back unknown plans to Free.
- Usage window uses UTC calendar month.
- Remaining values never go below zero.
- Watchlist count is total active rows, not monthly rows.
- Existing receipt and existing watchlist idempotency do not consume quota.

Route tests:

- `POST /api/comparisons` returns `402 plan_limit_reached` at 20 comparisons in
  the current month.
- Comparison creation succeeds at 19 and becomes 20.
- `POST /api/comparisons/[id]/watchlist` returns `402` at 10 active items for a
  new save.
- Duplicate watchlist save at 10 returns the existing entry.
- `POST /api/comparisons/[id]/receipt` returns `402` at 5 receipts for a new
  receipt.
- Existing receipt at 5 still returns the existing receipt.
- Wallet receipt route uses the same receipt gate.
- `GET /api/usage` returns the expected usage payload.

Frontend tests:

- Usage panel renders Free limits and remaining values.
- Compare button disables at comparison limit.
- Watchlist and receipt buttons disable only for the relevant feature.
- A `plan_limit_reached` response produces friendly action error copy.

Gates:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`

## 12. Migration And Rollout

Add one Prisma migration for `User.plan`.

Rollout order:

1. Ship schema and plan catalog.
2. Ship derived usage service and `/api/usage`.
3. Add server gates.
4. Add UI meter and friendly limit handling.
5. Verify production smoke: `/`, `/api/usage`, comparison create, watchlist
   save, receipt create.

Rollback:

- Reverting route gates returns V1 behavior.
- Keeping `User.plan` in the database is harmless if the app rolls back.

## 13. Future Billing Hand-Off

The next V2 slice can add Stripe without rewriting usage:

- Add Stripe customer/subscription fields to `User`.
- Update `User.plan` from webhook events.
- Keep `GET /api/usage` response stable.
- Keep route gates calling the same usage service.
- Optionally introduce a `UsageEvent` ledger only if billing needs auditable
  historical usage beyond derived counts.

## 14. Acceptance Criteria

1. Free users have hard server-side limits: 20 comparisons/month, 10 active
   watchlist items, 5 receipts/month.
2. The UI clearly shows remaining usage and disables only the affected actions.
3. Direct API calls cannot bypass comparison, watchlist, service receipt, or
   wallet receipt limits.
4. Existing watchlist saves and existing receipts remain idempotent at the
   limit.
5. No Stripe, billing, auth, or GenLayer contract changes are introduced.
6. Existing V1 behavior is unchanged while the user is under limits.
7. Lint, typecheck, build, and tests pass.
