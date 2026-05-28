# Beta Plus-Grant On Wallet Connect — Implementation Plan

Date: 2026-05-28
Status: ready for implementation
Branch: `docs/v2-beta-plus-grant-plan` (this PR), implementation branch TBD
Spec: [`docs/superpowers/specs/2026-05-28-beta-plus-grant-design.md`](../specs/2026-05-28-beta-plus-grant-design.md)

This plan turns the approved beta plus-grant design into implementation work:
drop the read-layer "everyone is effective-Plus" override, grant
`User.plan="plus"` inside the existing SIWE verify update when
`BILLING_ENABLED=false`, and refresh the two surfaces (`/pricing`, `/account`)
to reflect the new DB-as-truth model.

It does not change auth flow, schema, or Stripe code. Sub-project 2
(wallet+gmail auth redesign) is out of scope.

## 0. Preconditions

- Start from `master` at `e118d59` or later (spec already merged via PR #52).
- Current `BILLING_ENABLED` flag from PR #51 is preserved.
- Vercel preview env keeps `BILLING_ENABLED=false` for manual verification.
- Full verification at the end:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

## 1. File Scope

| File | Change |
|---|---|
| `src/lib/plans.ts` | Remove `getEffectivePlanId` |
| `src/lib/usage.ts` | Drop billing-flag ternary; use `user.plan` directly |
| `src/lib/account.ts` | Drop `effectivePlan` override; use `user.plan` directly |
| `src/app/api/auth/siwe/verify/route.ts` | Spread `{ plan: "plus" }` when billing disabled |
| `src/components/billing/PricingPlans.tsx` | Beta CTA: "Connect wallet & get Plus" |
| `src/components/account/AccountSettings.tsx` | Beta copy reflects DB plan |
| Existing tests for the above | Update / add cases per spec Section 5 |

Out of scope: schema, migrations, Stripe code, GenLayer contract, header nav.

## 2. Step-By-Step

### Step 1 — Drop read-layer override

Files:

- `src/lib/plans.ts`
- `src/lib/usage.ts`
- `src/lib/account.ts`
- `src/lib/__tests__/usage.test.ts`
- `src/lib/__tests__/account.test.ts` (and any colocated tests touching `effectivePlan`)

Tasks:

- Delete `getEffectivePlanId` export from `plans.ts`.
- In `usage.ts`, replace `getPlanDefinition(isBillingEnabled() ? user.plan : "plus")`
  with `getPlanDefinition(user.plan)`.
- In `account.ts`, drop the `effectivePlan = getEffectivePlanId(...)` line and
  any imports it pulled in. Set `effectivePlan = plan = resolvePlanId(user.plan)`.
- In `usage.test.ts`, remove the case
  "treats stored-free users as effective-Plus when BILLING_ENABLED=false".
- In `account.test.ts`, update any case that asserted the override behavior.
- Confirm no other caller of `getEffectivePlanId` remains: `rg getEffectivePlanId src`.

Acceptance:

- `rg getEffectivePlanId src` returns 0 hits.
- `npm run lint && npm run typecheck && npm test -- --runInBand src/lib` passes.
- Free users in tests now stay Free regardless of `BILLING_ENABLED`.

Commit: `refactor(v2): drop billing-flag plan override; user.plan is source of truth`

### Step 2 — Grant Plus inside SIWE verify when billing disabled

Files:

- `src/app/api/auth/siwe/verify/route.ts`
- `src/app/api/auth/siwe/verify/__tests__/route.test.ts`

Tasks:

- Import `isBillingEnabled` from the existing flag module.
- In the success-path `prisma.user.update`, change `data` to:

  ```ts
  data: {
    primaryWalletAddress: walletAddress,
    walletLinkedAt: new Date(),
    ...(!isBillingEnabled() ? { plan: "plus" } : {}),
  }
  ```

- Do not touch the two 409 branches (`wallet_change_required`,
  `wallet_already_linked`) or the `P2002` retry — they already `return`
  before the update, so plan write never fires on conflict (per spec Section 4
  conflict-path note).
- Add 4 route tests per spec Section 5:
  1. `BILLING_ENABLED=false` + visitor `plan="free"` → after verify, DB plan = `"plus"`.
  2. `BILLING_ENABLED=true` + visitor `plan="free"` → after verify, DB plan = `"free"`.
  3. `BILLING_ENABLED=false` + visitor `plan="plus"` re-verifying same wallet → DB plan stays `"plus"` (idempotent, 200).
  4. `BILLING_ENABLED=false` + 409 `wallet_already_linked` → DB plan unchanged for the rejecting visitor.

Acceptance:

- All 4 new test cases pass.
- Existing verify tests still pass.
- `npm test -- src/app/api/auth/siwe/verify` green.

Commit: `feat(v2): grant Plus on SIWE verify when BILLING_ENABLED=false`

### Step 3 — Pricing page beta CTA

Files:

- `src/components/billing/PricingPlans.tsx`
- `src/components/billing/__tests__/PricingPlans.test.tsx`

Tasks:

- When `billingEnabled === false`:
  - Plus tile: keep "Free during beta" header copy.
  - Replace `<Link href="/">Open app</Link>` with the existing
    `WalletSignInPrompt` component, plus CTA copy "Connect wallet & get Plus"
    and a one-line explanation that the wallet grants Plus during the open beta.
  - Free tile: unchanged.
- When `billingEnabled === true`: existing behavior unchanged.
- Update `PricingPlans.test.tsx`:
  - Replace any test that asserted "Open app" link in the beta branch with
    one asserting `WalletSignInPrompt` renders + the CTA copy.
  - Keep the billing-on test case untouched.

Acceptance:

- `npm test -- src/components/billing` green.
- Manually rendered (or via React Testing Library snapshot) the beta tile
  shows the SIWE prompt instead of the home link.

Commit: `feat(v2): beta pricing CTA prompts wallet connect for Plus`

### Step 4 — Account settings beta copy

Files:

- `src/components/account/AccountSettings.tsx`
- `src/components/account/__tests__/AccountSettings.test.tsx`

Tasks:

- In the billing panel, when `billingEnabled === false`:
  - If `account.plan === "plus"`: copy "You're on Plus during the open beta".
  - If `account.plan === "free"`: copy "Connect a wallet on /pricing to get Plus during beta" with a link to `/pricing`.
- Add 2 test cases for the billing-off branch (plan=free copy + link, plan=plus copy).
- Existing billing-on cases unchanged.

Acceptance:

- 2 new tests pass; existing tests pass.
- `npm test -- src/components/account` green.

Commit: `feat(v2): account settings reflect beta plan from DB`

### Step 5 — Full verification

Files: none.

Tasks:

- Run the full gauntlet:

  ```bash
  npm run lint
  npm run typecheck
  npm run build
  npm test
  ```

- Open Vercel preview with `BILLING_ENABLED=false` and walk through Section 6
  of the spec:
  1. Fresh browser → `/pricing` shows Connect wallet CTA, `/account` shows Free.
  2. SIWE connect → `/account` flips to Plus, copy updates.
  3. >20 comparisons → no `plan_limit_reached` (Plus unlimited).
  4. `/pricing` as connected wallet → renders without error.

Acceptance:

- All four lint/typecheck/build/test commands pass.
- Manual smoke matches expected outcomes.

Commit: none for this step; squash everything in PR.

## 3. PR Strategy

- Open one PR with all 4 implementation commits stacked.
- Target `master`. Title: `feat(v2): beta plus-grant on wallet connect`.
- Link spec PR #52 in the body, reference the design doc path.
- CI must pass `lint + typecheck + test`. CodeRabbit review optional.
- Squash-merge.

## 4. Out Of Scope (Reminder)

- No DB schema changes.
- No new auth method (no email/password, no social login).
- No Stripe code removal — gating stays via 503 from earlier PR.
- No retroactive grant for users already wallet-linked from pre-flag history.
- No downgrade-on-disconnect path. Beta-granted Plus stays until billing flips
  back, at which point Section 7 rollback SQL handles cleanup.

## 5. Rollback

If the rollout misbehaves, revert the implementation PR. The spec stays merged
as a record of intent. No data migration to undo because no schema changed,
and any beta-granted `plan="plus"` rows are safely cleaned up later by the
rollback SQL in spec Section 7.
