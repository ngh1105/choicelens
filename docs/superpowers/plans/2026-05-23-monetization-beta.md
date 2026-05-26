# ChoiceLens V2 Monetization Beta - Implementation Plan

Date: 2026-05-23
Status: approved direction, ready for implementation
Branch: `codex/v2-monetization-beta`
Spec: [`docs/superpowers/specs/2026-05-23-monetization-beta-design.md`](../specs/2026-05-23-monetization-beta-design.md)

This plan turns the approved monetization beta design into implementation work:
wallet-verified paid identity, Stripe Checkout for Plus, Stripe Billing Portal,
webhook-driven plan sync, pricing/account UI, and real upgrade CTAs.

It preserves the current visitor-based Free flow and does not add Pro checkout,
email/password auth, social auth, annual billing, coupons, affiliate changes, or
GenLayer contract changes.

## 0. Preconditions

- Start from `master` after the visitor identity PR is merged.
- Keep the existing untracked note
  `docs/superpowers/plans/2026-05-21-ui-refresh-followup.md` untouched unless
  the user explicitly asks to include it.
- Stripe test mode credentials are available before end-to-end smoke.
- WalletConnect config is available for local wallet testing, or the wallet UI
  path can be validated with mocked component tests.
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
| `package.json`, `package-lock.json` | Add Stripe and SIWE support dependencies |
| `.env.example` | Add billing/auth envs and correct Postgres wording |
| `prisma/schema.prisma` | Add wallet, billing, webhook, and wallet-change models |
| `prisma/migrations/**/migration.sql` | Add monetization beta migration |
| `src/lib/auth/siwe.ts` | New SIWE nonce/message/verification helpers |
| `src/lib/auth/walletSession.ts` | New signed wallet session cookie helpers |
| `src/lib/request-user.ts` | New resolver: wallet session user first, visitor user second |
| `src/lib/billing/stripe.ts` | New Stripe client/config/session helpers |
| `src/lib/billing/subscriptions.ts` | New subscription-to-plan sync helpers |
| `src/lib/account.ts` | New account read/update and wallet-change helpers |
| `src/app/api/auth/siwe/nonce/route.ts` | New SIWE nonce route |
| `src/app/api/auth/siwe/verify/route.ts` | New SIWE verify/session route |
| `src/app/api/billing/checkout/route.ts` | New Plus checkout route |
| `src/app/api/billing/portal/route.ts` | New Billing Portal route |
| `src/app/api/billing/webhook/route.ts` | New Stripe webhook route |
| `src/app/api/account/route.ts` | New account summary route |
| `src/app/api/account/recovery-email/route.ts` | New recovery email route |
| `src/app/api/account/wallet/change/route.ts` | New wallet-change request route |
| Existing user-facing API routes | Resolve wallet session user before visitor user |
| `src/components/auth/WalletSignInPrompt.tsx` | New reusable SIWE wallet prompt |
| `src/components/billing/PricingPlans.tsx` | New pricing plan UI |
| `src/components/account/*.tsx` | New account settings UI components |
| `src/app/pricing/page.tsx` | New pricing page |
| `src/app/account/page.tsx` | New account/settings page |
| `src/app/page.tsx` | Replace coming-soon copy with upgrade CTA |
| `src/app/globals.css` | Add pricing/account/upgrade CTA styles |
| Existing and new tests | Cover backend, UI, copy, and route behavior |

Avoid editing GenLayer service internals, comparison scoring, receipt contract
payloads, or unrelated visual polish.

## 2. Step-By-Step

### Step 1 - Dependencies, Environment, And Schema

Files:

- `package.json`
- `package-lock.json`
- `.env.example`
- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_monetization_beta/migration.sql`

Tasks:

- Add `stripe`.
- Add `siwe` unless the implementation chooses a fully tested `viem`-only SIWE
  verifier; prefer `siwe` for nonce/domain semantics.
- Add env docs:
  - `APP_BASE_URL`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PLUS_PRICE_ID`
  - `WALLET_SESSION_SECRET`
- Correct `.env.example` database comments so they match the current Postgres
  Prisma provider.
- Add `User` fields:
  - `primaryWalletAddress String? @unique`
  - `walletLinkedAt DateTime?`
  - `recoveryEmail String?`
  - `recoveryEmailVerifiedAt DateTime?`
  - `stripeCustomerId String? @unique`
  - `stripeSubscriptionId String? @unique`
  - `stripePriceId String?`
  - `stripeSubscriptionStatus String?`
  - `stripeCurrentPeriodEnd DateTime?`
- Add `WalletLinkRequest`.
- Add `StripeWebhookEvent`.
- Generate Prisma Client.

Acceptance:

- Migration applies locally.
- Prisma Client generation succeeds.
- Existing users remain valid Free users.

### Step 2 - SIWE Session Foundation

Files:

- `src/lib/auth/siwe.ts`
- `src/lib/auth/walletSession.ts`
- `src/app/api/auth/siwe/nonce/route.ts`
- `src/app/api/auth/siwe/verify/route.ts`
- `src/lib/__tests__/siwe.test.ts`
- `src/app/api/auth/siwe/**/__tests__/route.test.ts`

Tasks:

- Generate nonce responses tied to the current visitor user.
- Verify SIWE messages with domain, nonce, issued-at, and signature checks.
- Normalize wallet addresses before storing or comparing them.
- Promote the current visitor `User` into a wallet-linked user when the wallet
  is not already linked elsewhere.
- If the wallet is already linked to another user, return a controlled conflict
  instead of silently merging data.
- Set a short-lived signed HTTP-only wallet session cookie.
- Keep visitor cookie and wallet session cookie separate.

Acceptance:

- SIWE reject/replay cases fail.
- Valid SIWE links the current user and returns account summary.
- Wallet session cookie is HTTP-only and signed.

### Step 3 - Wallet-Aware Request User Resolver

Files:

- `src/lib/request-user.ts`
- `src/lib/__tests__/request-user.test.ts`
- Existing user-facing API routes under `src/app/api/**/route.ts`

Tasks:

- Add a resolver that returns:
  - wallet session user when a valid wallet session exists,
  - otherwise the current visitor user.
- Update existing user-facing routes to call this resolver:
  - `/api/usage`
  - `/api/comparisons`
  - `/api/watchlist`
  - `/api/watchlist/[id]`
  - `/api/comparisons/[id]`
  - `/api/comparisons/[id]/watchlist`
  - `/api/comparisons/[id]/receipt`
  - `/api/comparisons/[id]/receipt/build-input`
  - `/api/comparisons/[id]/receipt/wallet-tx`
- Preserve current response shapes and cookie behavior.

Acceptance:

- Plus users get Plus limits because the usage service sees their wallet-linked
  user record.
- Free visitors still work without wallet onboarding.
- Existing route tests still pass after mock updates.

### Step 4 - Account Read And Recovery Email

Files:

- `src/lib/account.ts`
- `src/app/api/account/route.ts`
- `src/app/api/account/recovery-email/route.ts`
- Tests under `src/lib/__tests__` and `src/app/api/account/**/__tests__`

Tasks:

- Return account summary:
  - effective plan,
  - primary wallet address,
  - recovery email presence/value,
  - Stripe subscription status,
  - current period end.
- Allow optional recovery email save/update only for the resolved current user.
- Validate email syntax conservatively.
- Do not make email an auth identity.

Acceptance:

- Recovery email can be added after purchase or before purchase.
- Invalid email returns `recovery_email_invalid`.
- Account summary does not expose secrets.

### Step 5 - Stripe Checkout And Billing Portal

Files:

- `src/lib/billing/stripe.ts`
- `src/app/api/billing/checkout/route.ts`
- `src/app/api/billing/portal/route.ts`
- Tests under `src/lib/__tests__` and `src/app/api/billing/**/__tests__`

Tasks:

- Initialize Stripe from `STRIPE_SECRET_KEY`.
- Require a valid wallet session before checkout.
- Create or reuse `stripeCustomerId` for the current user.
- Create Checkout Session for `STRIPE_PLUS_PRICE_ID` only.
- Use `APP_BASE_URL` for success/cancel URLs.
- Create Billing Portal Session only when `stripeCustomerId` exists.
- Return `checkout_unavailable`, `wallet_session_required`, or
  `billing_portal_unavailable` for controlled failures.

Acceptance:

- Checkout route cannot be used by a visitor-only user.
- Checkout route cannot request Pro.
- Portal route cannot be used before a customer exists.

### Step 6 - Stripe Webhook And Plan Sync

Files:

- `src/lib/billing/subscriptions.ts`
- `src/app/api/billing/webhook/route.ts`
- `src/app/api/billing/webhook/__tests__/route.test.ts`

Tasks:

- Use `request.text()` and `stripe.webhooks.constructEvent`.
- Store every Stripe event id in `StripeWebhookEvent` before processing.
- Make processing idempotent.
- Sync `User` fields from:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Set `User.plan = "plus"` only for active/trialing Plus subscriptions.
- Set `User.plan = "free"` for canceled, unpaid, incomplete expired, or deleted
  subscriptions.
- Do not grant Plus from success redirects.

Acceptance:

- Duplicate webhook events do not double-process.
- Plan changes are driven only by verified Stripe events.
- Failed webhook processing is recorded for follow-up.

### Step 7 - Wallet Change Flow

Files:

- `src/lib/account.ts`
- `src/app/api/account/wallet/change/route.ts`
- Tests under `src/lib/__tests__` and `src/app/api/account/wallet/change/**`

Tasks:

- Require an active wallet session for the currently linked wallet.
- Create a short-lived `WalletLinkRequest` for a requested new wallet.
- Require a fresh signature from the new wallet.
- Require final confirmation from the current linked account before replacing
  `primaryWalletAddress`.
- Detect conflicts when the requested wallet already belongs to another user.

Acceptance:

- Wallet cannot change silently.
- Old wallet is not kept as a second primary.
- Expired requests cannot be confirmed.

### Step 8 - Pricing UI And SIWE Prompt

Files:

- `src/components/auth/WalletSignInPrompt.tsx`
- `src/components/billing/PricingPlans.tsx`
- `src/app/pricing/page.tsx`
- `src/app/globals.css`
- UI tests under `src/app/pricing/**` or `src/components/**/__tests__`

Tasks:

- Add a compact `/pricing` page using existing panel, button, pill, and grid
  styles.
- Show Free, Plus, and Pro.
- Plus copy:
  - `Plus`
  - `$12/mo`
  - `Billed monthly`
  - `No monthly caps on core comparison actions`
  - `Wallet-linked paid identity`
  - `Stripe billing portal access`
- Pro copy:
  - `Pro`
  - `Catalog only`
  - `Not self-serve yet`
  - `Reserved for bulk/team workflows later`
- Add SIWE prompt states:
  - wallet unavailable,
  - wallet disconnected,
  - wallet connected but unsigned,
  - signed session ready,
  - signing rejected.
- Trigger `/api/billing/checkout` only after wallet session exists.

Acceptance:

- `/pricing` is usable as the first viewport, not a marketing landing page.
- Pro has no checkout CTA.
- Buttons and text fit at mobile widths.

### Step 9 - Account UI

Files:

- `src/app/account/page.tsx`
- `src/components/account/AccountSettings.tsx`
- `src/components/account/RecoveryEmailForm.tsx`
- `src/components/account/BillingPortalButton.tsx`
- `src/components/account/PrimaryWalletPanel.tsx`
- `src/app/globals.css`
- UI tests under `src/app/account/**` or `src/components/account/**`

Tasks:

- Fetch `GET /api/account`.
- Show plan, wallet, subscription status, and optional recovery email.
- Add recovery email form.
- Add Billing Portal action.
- Add wallet-change affordance with explicit confirmation copy.

Acceptance:

- Account UI does not treat email as login.
- Billing Portal action degrades clearly when unavailable.
- Wallet-change UI does not imply multiple primary wallets.

### Step 10 - Inline Upgrade CTA

Files:

- `src/app/page.tsx`
- `src/app/__tests__/page-usage.test.ts`
- `src/app/globals.css`

Tasks:

- Replace `Paid plan upgrades are coming soon.` with
  `Upgrade to Plus to keep going.`
- Link or button to `/pricing` from:
  - API `plan_limit_reached` action error copy,
  - local limit copy,
  - UsagePanel blocked note,
  - receipt limit note.
- Keep current action disabling semantics.

Acceptance:

- Limit-hit states point to a real upgrade path.
- Existing under-limit behavior remains unchanged.

### Step 11 - Verification And Smoke

Run:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Local smoke:

1. Start the app with Postgres and Stripe test envs.
2. Load `/` as a fresh visitor and confirm Free usage still works.
3. Hit a mocked or seeded Free limit and open `/pricing`.
4. Connect wallet and complete SIWE.
5. Start Plus checkout.
6. Complete Stripe test-mode payment.
7. Confirm webhook updates `User.plan` to `plus`.
8. Confirm `/api/usage` and UI show Plus behavior.
9. Open `/account`.
10. Save recovery email.
11. Open Stripe Billing Portal.

If Stripe CLI or webhook forwarding is unavailable locally, run route-level tests
and document the exact manual production/staging verification still needed.

## 3. Subagent Split For Implementation

Use subagents for disjoint work slices:

- **Backend Worker A**: schema, env, SIWE, wallet session, request-user resolver.
- **Backend Worker B**: Stripe checkout, portal, webhook, subscription sync.
- **Frontend Worker C**: pricing page, SIWE prompt, inline upgrade CTA.
- **Frontend Worker D**: account page, recovery email, billing portal UI, wallet
  change UI.
- **Reviewer Agent**: review the final diff for auth/billing regressions and
  missing tests.

Workers must not revert one another's changes. Keep write scopes disjoint until
the main thread integrates route types and shared components.

## 4. PR Checklist

- Push `codex/v2-monetization-beta`.
- Open PR titled `feat(v2): add wallet-first plus billing`.
- PR body includes:
  - wallet-first paid identity summary,
  - Stripe Checkout and Billing Portal summary,
  - webhook plan-sync behavior,
  - migration notes,
  - environment variables,
  - test output,
  - explicit non-goals: no Pro checkout, no email login, no GenLayer contract
    changes.
- Before production deploy:
  - create Stripe Plus monthly price,
  - set production env vars,
  - run `npm run db:deploy`,
  - verify Stripe webhook endpoint,
  - perform one test-mode or staging checkout smoke.

## 5. Risks And Rollback

Risks:

- **Visitor-to-wallet promotion can strand existing visitor data.**
  Mitigation: link the current visitor user in place when possible; return a
  controlled conflict when the wallet already belongs to another user.
- **Checkout redirect grants false access.**
  Mitigation: only verified Stripe webhook events can set `User.plan = "plus"`.
- **Wallet receipt signing is confused with wallet auth.**
  Mitigation: keep SIWE helpers separate from `WalletReceiptControls`.
- **Stripe webhook body parsing breaks signature verification.**
  Mitigation: use raw `request.text()` and test signature failure paths.
- **Cookie-authenticated POST routes invite CSRF risk.**
  Mitigation: keep wallet sessions short-lived, verify SIWE domain/nonce, and
  use same-origin fetches for account/billing mutations.
- **Home page grows too large.**
  Mitigation: put new pricing/account/SIWE UI in dedicated components.

Rollback:

- Revert the implementation PR to remove billing and wallet session behavior.
- Keeping new nullable `User` billing fields is harmless during rollback.
- If plan sync misbehaves, disable checkout routes and webhook processing while
  preserving existing Free visitor usage.

## 6. Definition Of Done

1. Free visitors can still compare, watchlist, and build receipts without wallet
   onboarding.
2. Plus checkout requires a verified wallet session.
3. Stripe Checkout sells only Plus monthly.
4. Stripe Billing Portal handles billing changes.
5. Verified Stripe webhooks update `User.plan`.
6. `/pricing` and inline limit CTAs point to the real upgrade path.
7. `/account` exposes plan, wallet, billing, and optional recovery email.
8. Wallet change requires explicit confirmation.
9. Pro is catalog-only.
10. Lint, typecheck, build, tests, and a documented Stripe smoke pass.
