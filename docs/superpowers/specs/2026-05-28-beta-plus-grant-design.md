# Beta Plus-Grant On Wallet Connect — Design Spec

Date: 2026-05-28
Status: pending approval
Owner: project founder
Sub-project: 1 of 2 (sub-project 2 = redesign auth flow for wallet+gmail confusion)

## 1. Problem

PR #51 introduced `BILLING_ENABLED=false` to run the V2 stack as full-Free
during open beta. The current implementation overrides `User.plan` at the
read layer:

- `usage.ts` calls `getPlanDefinition(isBillingEnabled() ? user.plan : "plus")`.
- `account.ts` returns `effectivePlan = getEffectivePlanId(user.plan, isBillingEnabled())`.

Effect: every visitor — including unauthenticated visitors with no wallet —
shows up as Plus and gets unlimited usage. The user flagged this as wrong:

> nếu chưa tài khoản thì phải set mặc định là free, nếu có tài khoản và
> vào pricing chọn plus thì mới được cấp lên plus

The runtime override also blurs the meaning of `User.plan`: the DB column
says `free`, the response says `plus`, the UI claims Plus. Two sources of
truth that disagree by env flag.

## 2. Selected Approach

**Approach A — "Connect wallet & get Plus" 1-button flow.**

When `BILLING_ENABLED=false`, the SIWE verify endpoint that already sets
`primaryWalletAddress` ALSO writes `plan: "plus"` in the same `prisma.user.update`.

Outcome:

- No wallet → `User.plan="free"` (DB truth) → Free caps apply.
- Wallet connected during beta → `User.plan="plus"` (DB truth) → unlimited.
- Beta off later → SIWE verify stops auto-granting, Stripe checkout grants Plus.

`User.plan` becomes the single source of truth. Reads stop overriding it.

## 3. Non-Goals

- No new auth flow. SIWE stays the only paid identity rail.
- No email/password, no social login, no Web2-style "link wallet to email".
- No DB schema change.
- No Stripe code removal — webhook + checkout stay intact, just gated by 503.
- No retroactive grant for users who already have a wallet linked from
  pre-flag history. (Negligible — beta is fresh; if needed later, run a
  one-off SQL update, not a migration.)
- No downgrade-on-disconnect path. Disconnecting wallet does not revert plan.
  Beta-granted Plus stays until `BILLING_ENABLED=true` flips it back to a
  Stripe-driven world.

## 4. Files Changed

1. **`src/lib/plans.ts`** — remove `getEffectivePlanId`. No longer needed.
2. **`src/lib/usage.ts`** — `getPlanDefinition(user.plan)` (drop the ternary).
3. **`src/lib/account.ts`** — drop `effectivePlan` override; `effectivePlan = plan = resolvePlanId(user.plan)`.
4. **`src/app/api/auth/siwe/verify/route.ts`** — extend the existing
   `prisma.user.update` data block. Import `isBillingEnabled` and spread a
   conditional `plan` field:
   ```ts
   data: {
     primaryWalletAddress: walletAddress,
     walletLinkedAt: new Date(),
     ...(!isBillingEnabled() ? { plan: "plus" } : {}),
   }
   ```
   No extra DB read — same UPDATE statement, one extra column when billing
   is off. Behaviorally idempotent: re-verifying as an existing Plus user
   writes `plan="plus"` again with no observable change. When billing is on,
   the field is absent and Stripe webhooks remain the only writer of `plan`.

   **Conflict path:** the existing `wallet_change_required` (409) and
   `wallet_already_linked` (409, including the `P2002` retry) branches
   `return` before the `user.update`, so `plan` is never written when verify
   fails. No additional handling needed.

   **Stripe-paid user reconnecting in beta:** if a user with
   `stripeCustomerId IS NOT NULL` but `plan="free"` (cancelled sub) connects
   a wallet during beta, they are upgraded to Plus by the spread. This is
   intentional under "beta is fully Free" framing — no one pays during beta.
   The Section 7 rollback SQL (`stripeCustomerId IS NULL`) deliberately
   leaves these users alone, which means a cancelled Stripe customer stays
   on Plus after beta ends. Acceptable trade-off; revisit only if a
   Stripe-paid cohort exists when beta ends.
5. **`src/components/billing/PricingPlans.tsx`** — when `billingEnabled=false`:
   - Plus tile: keep "Free during beta" copy.
   - Replace `<Link href="/">Open app</Link>` with `<WalletSignInPrompt>` +
     CTA "Connect wallet & get Plus" — explains beta grant, drives SIWE.
   - Free tile: keep as-is (current visitor flow).
6. **`src/components/account/AccountSettings.tsx`** — Billing panel
   (`billingEnabled=false` branch):
   - If `account.plan === "plus"`: copy "You're on Plus during the open beta".
   - If `account.plan === "free"`: copy "Connect a wallet on /pricing to get
     Plus during beta" + link to `/pricing`.

## 5. Test Plan

Vitest:

- `usage.test.ts`: drop the "treats stored-free users as effective-Plus when
  BILLING_ENABLED=false" test (behavior removed). Keep the rest.
- `siwe/verify` route test: add 4 cases —
  - `BILLING_ENABLED=false` + visitor `plan="free"` → after verify, DB plan = `"plus"`.
  - `BILLING_ENABLED=true` + visitor `plan="free"` → after verify, DB plan = `"free"` (untouched).
  - `BILLING_ENABLED=false` + visitor `plan="plus"` re-verifying same wallet → DB plan stays `"plus"` (idempotent, no error).
  - `BILLING_ENABLED=false` + 409 conflict path (wallet already linked to another user) → DB plan unchanged for the rejecting visitor.
- `PricingPlans.test.tsx`: update the `billingEnabled=false` case to assert
  `WalletSignInPrompt` renders + CTA copy.
- `AccountSettings.test.tsx`: add 2 cases for the billing-off branch (plan=free vs plan=plus copy).
- `flag.test.ts`: unchanged.

Build/type: `npm run lint && npm run typecheck && npm test`.

## 6. Manual Verification

On preview with `BILLING_ENABLED=false`:

1. Open in fresh browser → visitor identity created → `/pricing` shows
   "Free during beta" + Connect wallet CTA. `/account` shows plan=Free,
   billing copy points at `/pricing`.
2. Connect wallet via SIWE → `/account` plan flips to Plus, billing copy
   says "You're on Plus during the open beta".
3. Hammer comparisons past 20 → no `plan_limit_reached` (Plus is unlimited).
4. Visit `/pricing` again as connected wallet → still works, no error.

## 7. Rollback / Beta-End Transition

When `BILLING_ENABLED=true` is restored, beta-granted Plus users will have
`plan="plus"` but `stripeCustomerId=null` and no subscription — they keep
unlimited access without paying. This is intentional during beta. To
require payment after beta ends, run:

```sql
UPDATE "User" SET plan='free' WHERE plan='plus' AND "stripeCustomerId" IS NULL;
```

This restores Free for users who got Plus from SIWE but never paid Stripe.
Stripe-paid Plus users (`stripeCustomerId IS NOT NULL`) keep their plan.

To stop new grants without revoking existing ones: set `BILLING_ENABLED=true`
and do not run the SQL.
