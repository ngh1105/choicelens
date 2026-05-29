# Runbook — V2 Monetization Beta smoke

Operator-facing procedure for the wallet-first Plus billing slice shipped in
PR #24. Read alongside
`docs/superpowers/specs/2026-05-23-monetization-beta-design.md` and
`docs/superpowers/plans/2026-05-23-monetization-beta.md`.

This runbook covers Stripe test-mode bring-up, end-to-end checkout smoke, and
the manual checks that need to pass before production rollout.

## 1. Stripe test-mode setup

1. **Create a test-mode product and price.**
   - Stripe Dashboard → Test Mode → Products → New product.
   - Name: `ChoiceLens Plus`.
   - Pricing: `Recurring`, `$12.00 USD`, `monthly`, `Standard pricing`.
   - Copy the resulting `price_...` id. This is `STRIPE_PLUS_PRICE_ID`.

2. **Create a webhook endpoint.**
   - Local: `stripe listen --forward-to localhost:3000/api/billing/webhook`
     prints a `whsec_...` signing secret. Use it as `STRIPE_WEBHOOK_SECRET`.
   - Staging/Prod: Stripe Dashboard → Developers → Webhooks → Add endpoint
     `https://<host>/api/billing/webhook`. Subscribe to:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.

3. **Get the Stripe API key.**
   - Test mode: Stripe Dashboard → Developers → API keys → Secret key
     (`sk_test_...`). Use as `STRIPE_SECRET_KEY`.
   - Production rotates a separate live key. Never mix live and test keys.

## 2. Required environment variables

Set these before running the app:

| Var | Example | Notes |
|---|---|---|
| `APP_BASE_URL` | `http://localhost:3000` | Used as SIWE domain and Stripe success/cancel URLs |
| `STRIPE_SECRET_KEY` | `sk_test_...` | Test or live secret key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From `stripe listen` or dashboard endpoint |
| `STRIPE_PLUS_PRICE_ID` | `price_...` | Plus monthly price |
| `WALLET_SESSION_SECRET` | 32+ random bytes | Required in production. HMAC key for the wallet session cookie |
| `DATABASE_URL` | `postgresql://...` | Existing Postgres URL |

Generate a strong `WALLET_SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Treat all five `STRIPE_*` and `WALLET_SESSION_SECRET` values like the GenLayer
service key — secret manager only, never committed.

## 3. Database migration

The PR adds the migration
`prisma/migrations/20260523193822_monetization_beta/`. It is additive: nullable
`User` columns plus the new `WalletLinkRequest` and `StripeWebhookEvent`
tables. Existing visitor data is unaffected.

Apply with:

```bash
npm run db:deploy
```

Verify the new columns and tables exist:

```sql
\d "User"
\dt "WalletLinkRequest"
\dt "StripeWebhookEvent"
```

If rolling back, the safest path is to leave the columns and tables in place
and revert the application PR. The columns are nullable and harmless.

## 4. End-to-end checkout smoke

Run this once per environment after wiring envs and applying the migration.

### 4.1 Free baseline (regression check)

1. Open `/` in a private window. Confirm:
   - Wallet pill shows `Wallet ready` or `Wallet optional` — not an error.
   - Free plan pill renders with the comparisons remaining counter.
2. Run a comparison. It must succeed without wallet onboarding.
3. Save to watchlist, build a receipt — Free flow must keep working.

### 4.2 Hit the Free limit

1. Repeat comparisons until `plan_limit_reached` fires.
2. The action error must read `Upgrade to Plus to keep going.` followed by
   the inline `View pricing` link to `/pricing` — not the legacy
   `Paid plan upgrades are coming soon.` copy.

### 4.3 Connect wallet + SIWE

1. Click `Connect` in the header (or the prompt on `/pricing`).
2. Approve the wallet connection in the browser wallet.
3. Click `Sign session` in the `/pricing` Plus tile.
4. Approve the SIWE personal_sign request.
5. The prompt should flip to `Wallet session ready. Checkout can start.`
6. Confirm the response set the `cl_wallet_session` cookie:
   ```bash
   curl -i -X POST $APP_BASE_URL/api/auth/siwe/nonce | grep -i set-cookie
   ```
   Expect a signed `cl_wallet_session=` cookie with `HttpOnly` and `SameSite=Lax`.

### 4.4 Plus checkout

1. With the wallet session ready, click `Upgrade to Plus`.
2. The browser should redirect to a Stripe Checkout page hosted on
   `checkout.stripe.com`.
3. Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry, any
   3-digit CVC, any zip.
4. Stripe redirects back to `${APP_BASE_URL}/account?billing=success`.

### 4.5 Webhook plan sync

While the checkout completes, watch the `stripe listen` output. Expect:

```
checkout.session.completed
customer.subscription.created
```

After both fire, query the database:

```sql
SELECT id, plan, "primaryWalletAddress", "stripeCustomerId",
       "stripeSubscriptionId", "stripeSubscriptionStatus"
FROM "User"
WHERE "primaryWalletAddress" IS NOT NULL
ORDER BY "walletLinkedAt" DESC NULLS LAST
LIMIT 5;
```

Expect `plan = 'plus'` and `stripeSubscriptionStatus = 'active'` for the
test user.

Sanity-check the webhook table:

```sql
SELECT id, type, status, "processedAt"
FROM "StripeWebhookEvent"
ORDER BY "receivedAt" DESC
LIMIT 5;
```

Each event should land once with `status = 'processed'`. Replays from Stripe
must be marked `duplicate` in the response and must not flip `User.plan`
again.

### 4.6 Account surface

1. Open `/account`.
2. Confirm:
   - `Plan` row reads `Plus`.
   - `Subscription` row matches the Stripe status.
   - `Current period` row shows the test-mode renewal date.
   - `Wallet` panel shows the linked address.
3. Save a recovery email. Confirm the form clears its busy state and the
   stored value persists across reloads.
4. Click `Open billing portal`. Stripe Billing Portal must open with the
   test customer. Cancel the subscription from the portal.
5. Wait for `customer.subscription.updated` (status `canceled` or
   `cancel_at_period_end`) or `customer.subscription.deleted`. Confirm
   `User.plan` flips back to `free` exactly when the subscription is no
   longer active.

### 4.7 Wallet change flow

1. Stay signed in on the original wallet.
2. From the wallet panel, request a change to a second test wallet.
3. The server returns a `WalletLinkRequest` with a `challengeNonce` and
   `expiresAt`.
4. Submit a fresh SIWE signature from the new wallet against that nonce.
5. Confirm:
   - `User.primaryWalletAddress` updates to the new address.
   - `walletLinkedAt` is refreshed.
   - The `cl_wallet_session` cookie is reissued for the new wallet.
   - The old `WalletLinkRequest` row is `status = 'confirmed'`.
6. Repeat the request and let the 10-minute TTL expire without confirming.
   The server must reject the stale confirmation with
   `wallet_change_not_found`.

## 5. Local-safe readiness check

Before using Stripe test-mode credentials, run the repository-only readiness
check. It does not call Stripe, does not require secrets, and fails if a live
Stripe secret is present in the shell environment:

```bash
npm run stripe:smoke:readiness
```

The check verifies that the billing routes, webhook idempotency/retry code,
required env documentation, migration, and this runbook are present. Passing
this check is not a substitute for the external Stripe smoke below; it is a
preflight guard before entering test secrets or touching the dashboard.

## 6. Security and idempotency checks

Before declaring the slice production-ready:

1. **Webhook signature failure path.** Send a malformed body or wrong
   signature to `/api/billing/webhook`. The server must respond `400
   invalid_signature` and write nothing to `StripeWebhookEvent`.
2. **Webhook replay safety.** Use `stripe events resend <evt_...>` against an event
   that already processed. The second call must return `duplicate: true`
   and `User.plan` must not move.
3. **Subscription update/delete.** In the test subscription, trigger or wait for
   both `customer.subscription.updated` and `customer.subscription.deleted` paths:
   - Update: cancel at period end, resume, or change quantity/price in Stripe's
     test dashboard/portal. Confirm active or trialing Plus-price subscriptions
     keep `User.plan = 'plus'`, while `past_due`, `unpaid`, and other inactive
     statuses write `User.plan = 'free'`.
   - Delete: fully cancel/delete the test subscription. Confirm
     `stripeSubscriptionStatus` is preserved as `canceled` or another known
     free status, and `User.plan = 'free'`.
4. **Downgrade/cancel timing.** A `cancel_at_period_end` subscription can still
   be `active`; do not expect downgrade until Stripe sends an inactive status or
   deleted event. Record the event id that actually flipped the plan.
5. **Failed webhook recovery.** If a row in `StripeWebhookEvent` is `failed`, fix
   the downstream cause, then use `stripe events resend <evt_...>`. The retry
   should move the row through `processing` to `processed`. If a row is stuck in
   `processing` for more than 5 minutes, resending the same event should also be
   accepted for reprocessing.
6. **Visitor isolation.** A request without `cl_wallet_session` must never
   succeed at `/api/billing/checkout`, `/api/billing/portal`,
   `/api/account/recovery-email`, or the wallet-change routes. Expect
   `401 wallet_session_required`.
7. **Wallet conflict.** Linking a wallet that already belongs to a
   different `User` row must return `409 wallet_already_linked`. The
   existing user's data must remain intact.
8. **Cookie hardening.** Production responses must set `cl_wallet_session`
   with `Secure`, `HttpOnly`, and `SameSite=Lax`. Inspect with browser
   devtools or `curl -i`.
9. **No prompt leakage.** Stripe customer/subscription metadata must only
   contain `userId` and `walletAddress`. Confirm by reading a fresh
   customer in the Stripe Dashboard.

## 7. Production rollout

Order matters; do not skip steps.

1. Apply the migration: `npm run db:deploy`.
2. Set production secrets in the host's secret manager:
   - `APP_BASE_URL=https://choicelens-beta.vercel.app`
   - `STRIPE_SECRET_KEY=sk_live_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...` (from the live-mode endpoint)
   - `STRIPE_PLUS_PRICE_ID=price_...` (live-mode Plus monthly)
   - `WALLET_SESSION_SECRET=<32+ random bytes, fresh per environment>`
3. Add the live-mode webhook endpoint in Stripe Dashboard. Subscribe to
   the four events listed in section 1.
4. Deploy the merged PR.
5. Run the section 4 smoke against production with a real test card on a
   throwaway wallet, then immediately cancel through the portal.
6. Confirm `User.plan` returns to `free` on cancellation.

## 8. Rollback

The slice is structured so a rollback does not require a destructive
migration:

- Revert the application PR to remove the new routes, components, and
  request-user wallet logic.
- Leave the `User.*` billing/wallet columns and the `WalletLinkRequest` /
  `StripeWebhookEvent` tables in place — they are nullable and additive.
- Disable the live Stripe webhook endpoint in the dashboard so events
  stop reaching the reverted app.
- If a Stripe customer was charged before rollback, refund through the
  Stripe Dashboard. Do not edit `User.plan` manually except as a last
  resort, and only after the subscription is canceled in Stripe.

## 9. Known follow-ups (not in this slice)

These are intentionally out of scope for the beta and tracked separately:

- Plus annual billing and coupons.
- Pro self-serve checkout.
- Team/seats workflow.
- Recovery email verification flow.
- Watchlist alert product.
