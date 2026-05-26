# ChoiceLens V2 Monetization Beta - Design Spec

Date: 2026-05-23
Status: approved for implementation planning
Owner: project founder
Branch: `codex/v2-monetization-beta-design`

## 1. Goal

Turn the existing V2 usage gates into a real monetization beta:

- keep the current visitor-based Free flow working,
- require wallet connection before paid checkout,
- sell Plus as a monthly Stripe subscription,
- keep Pro visible in the catalog but not self-serve yet,
- make recovery email optional after purchase, not a checkout prerequisite.

This slice is wallet-first only at the paid boundary. Free usage stays
visitor-scoped; paid identity becomes wallet-scoped.

## 2. Selected Approach

### Checkout

Use **Stripe Checkout Session** for Plus signup.

Reason: it keeps PCI scope low, reuses Stripe's billing UI, and avoids building
a custom payment form for a beta.

### Subscription Management

Use **Stripe Billing Portal** for cancel, payment method changes, and invoice
downloads.

Reason: the app should own identity and plan policy, while Stripe owns billing
ops.

### Identity

Use **SIWE** for wallet verification and a short-lived HTTP-only wallet session.

Reason: wallet is the paid identity rail, but the app does not need a full auth
framework yet.

### Plan Scope

- **Free**: current hard caps.
- **Plus**: self-serve monthly plan.
- **Pro**: catalog-only for now.

## 3. Non-Goals

- No email/password login.
- No social login.
- No annual billing.
- No coupon or promo-code system.
- No custom card form.
- No Pro self-serve checkout.
- No new GenLayer contract work.
- No watchlist alert product yet.
- No affiliate monetization changes.

## 4. Current System Fit

This beta builds on code that already exists:

- `src/lib/usage.ts` already computes plan usage and emits `plan_limit_reached`.
- `src/lib/visitor.ts` already partitions free state per browser.
- `src/app/page.tsx` already renders usage state and blocks actions.
- `src/lib/wallet.ts`, `WalletReceiptControls`, and `WalletPathToggle` already
  provide the wallet stack.

The missing piece is the paid path: a real upgrade flow, a billing account
model, and webhook-driven plan sync.

## 5. Product Model

The product keeps two identity layers:

1. Visitor identity for Free usage and saved state.
2. Primary wallet identity for paid access.

The upgrade flow promotes the current user record into a wallet-linked paid
account. The same user keeps their existing comparisons, watchlist, and
receipts.

The wallet is the canonical paid identity. Recovery email is only a secondary
contact channel.

## 6. Data Model

### `User`

Keep existing fields and add billing/identity fields:

- `primaryWalletAddress String? @unique`
- `walletLinkedAt DateTime?`
- `recoveryEmail String?`
- `recoveryEmailVerifiedAt DateTime?`
- `stripeCustomerId String? @unique`
- `stripeSubscriptionId String? @unique`
- `stripePriceId String?`
- `stripeSubscriptionStatus String?`
- `stripeCurrentPeriodEnd DateTime?`

`plan` remains the effective entitlement field and continues to drive usage
gates.

### `WalletLinkRequest`

Small helper table for explicit wallet-change confirmation:

- `id`
- `userId`
- `requestedWalletAddress`
- `challengeNonce`
- `status`
- `expiresAt`
- `createdAt`
- `confirmedAt`

### `StripeWebhookEvent`

Small helper table for webhook idempotency:

- `id` (`Stripe` event id)
- `type`
- `status`
- `receivedAt`
- `processedAt`
- `errorMessage`

## 7. Billing And Wallet Flow

1. User hits a limit or opens `/pricing`.
2. The app asks them to connect a wallet if none is connected.
3. The app verifies the wallet with SIWE.
4. The server creates or reuses a Stripe customer for that user.
5. The server creates a Stripe Checkout Session for Plus monthly billing.
6. Stripe returns the user to the app after payment.
7. Webhooks update `User.plan` and subscription metadata.
8. The account page offers Stripe Billing Portal for billing changes.

Wallet connection happens before checkout. Recovery email is not required at the
purchase step.

## 8. Wallet Change Flow

The account supports one primary wallet at a time.

- Changing it requires the current wallet session to be active.
- The app must collect a fresh signature from the new wallet and a final
  explicit confirmation from the currently linked account before the primary
  wallet is replaced.
- The old wallet is not kept as a second primary identity.

The server should model this as a short-lived wallet-link request so the flow
can be retried safely without silently replacing identity.

## 9. Pricing And Upgrade UX

### Pricing Page

Add `/pricing` as a compact utility page, not a marketing landing page.

It should show:

- current plan context,
- Free,
- Plus,
- Pro,
- one primary upgrade action.

### Plus Copy

Use this as the Plus surface copy:

- `Plus`
- `$12/mo`
- `Billed monthly`
- `No monthly caps on core comparison actions`
- `Wallet-linked paid identity`
- `Stripe billing portal access`

### Pro Copy

Pro is catalog-only for now:

- `Pro`
- `Catalog only`
- `Not self-serve yet`
- `Reserved for bulk/team workflows later`

### Inline Upgrade CTA

When a limit is hit, the app should show an inline CTA that takes the user to
the pricing flow.

The limit-hit copy should say:

- `Upgrade to Plus to keep going.`

Do not keep the old `coming soon` copy once Stripe checkout exists.

## 10. API Surface

Keep the existing usage API and add billing/account routes:

- `GET /api/usage`
- `POST /api/auth/siwe/nonce`
- `POST /api/auth/siwe/verify`
- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `POST /api/billing/webhook`
- `GET /api/account`
- `PATCH /api/account/recovery-email`
- `POST /api/account/wallet/change`

Notes:

- `POST /api/billing/checkout` only accepts Plus.
- `POST /api/billing/portal` only works when a Stripe customer exists.
- `POST /api/billing/webhook` must verify Stripe signatures and be idempotent.
- `GET /api/account` powers the billing/identity settings UI.

## 11. Error Handling

Keep `plan_limit_reached`, but change the user-facing response and client copy so
it points to a real upgrade path.

Expected surfaced errors:

- `plan_limit_reached`
- `wallet_not_connected`
- `wallet_session_required`
- `siwe_rejected`
- `checkout_unavailable`
- `billing_portal_unavailable`
- `recovery_email_invalid`
- `wallet_change_conflict`

User-facing guidance:

- limit hit -> `Upgrade to Plus to keep going`
- wallet missing -> `Connect your wallet first`
- SIWE missing -> `Sign in with your wallet to continue`
- portal unavailable -> `Billing portal is not ready yet`

Webhook failures stay internal and should not break the app shell.

## 12. Security And Privacy

- SIWE must be nonce-protected.
- Wallet session cookies must be HTTP-only.
- Recovery email is optional and separate from wallet identity.
- Stripe metadata should not include raw prompts or private comparison content.
- Stripe webhook signatures must be verified.
- Visitor cookies and wallet sessions must stay separate.
- Wallet changes must require explicit confirmation.
- No user-facing page should treat email as the login identity.

## 13. Testing Strategy

Unit and route tests should cover:

- Plus and Pro plan metadata.
- SIWE nonce and verify flow.
- Checkout session creation.
- Billing portal session creation.
- Webhook idempotency.
- Wallet-link change confirmation.
- Recovery email save/update.
- `plan_limit_reached` action copy.
- `/pricing` rendering for Plus and catalog-only Pro.

Smoke tests:

- connect wallet,
- sign SIWE,
- start Plus checkout,
- complete a Stripe test-mode purchase,
- confirm `User.plan` becomes `plus`,
- open Billing Portal,
- add optional recovery email,
- hit a usage limit and verify the upgrade CTA.

## 14. Rollout

1. Add the new billing and identity fields.
2. Ship SIWE session creation.
3. Ship Stripe Checkout Session and Billing Portal routes.
4. Ship webhook processing and plan sync.
5. Add `/pricing` and account settings UI.
6. Add recovery email and wallet-change flows.
7. Verify with Stripe test mode before production.

## 15. Acceptance Criteria

1. Free visitors can still use the app without wallet onboarding.
2. Users must connect a wallet before starting Plus checkout.
3. Plus is purchasable as a monthly Stripe subscription.
4. Billing changes are handled through Stripe Billing Portal.
5. Recovery email is optional and can be added after purchase.
6. Pro is visible in the catalog but not self-serve.
7. `plan_limit_reached` now leads to a real upgrade path.
8. No GenLayer contract changes are introduced.
9. Lint, typecheck, build, and tests pass.
