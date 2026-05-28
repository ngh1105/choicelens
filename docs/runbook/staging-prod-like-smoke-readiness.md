# Staging / prod-like smoke readiness checklist

Use this checklist before a staging or production-like rollout. It intentionally avoids real secrets in repo commands; load environment values from the target secret manager or a local uncommitted `.env` file.

## Scope

Covers the current rollout-critical paths:

- Postgres migration readiness.
- Duplicate `User.recoveryEmail` scan before the unique-index migration.
- Stripe test-mode checkout and webhook idempotency.
- GenLayer Studionet service-account smoke.
- Wallet recovery local and browser smoke.

## 0. Safety rules

- Do **not** paste real `STRIPE_*`, `GENLAYER_SERVICE_PRIVATE_KEY`, `ADMIN_API_TOKEN`, `DATABASE_URL`, or wallet-session secrets into docs, issues, chat, or committed files.
- Use Stripe **test mode** for staging smoke unless the production rollout step explicitly says live mode.
- Do not run `prisma migrate reset` against staging/prod-like data.
- For production-style environments, prefer `npm run db:deploy` over `npm run db:migrate`.

## 1. Environment preflight

Required for all prod-like smokes:

- `DATABASE_URL=postgresql://...` or `postgres://...`
- `APP_BASE_URL=https://<target-host>`
- `WALLET_SESSION_SECRET=<32+ random bytes>`
- `WALLET_RECOVERY_TOKEN_SECRET=<distinct 32+ random bytes>` recommended

For Stripe checkout/webhook smoke:

- `BILLING_ENABLED=true`
- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `STRIPE_PLUS_PRICE_ID=price_...`

For GenLayer Studionet smoke:

- `GENLAYER_NETWORK=studionet`
- `GENLAYER_RPC_URL=https://studio.genlayer.com/api`
- `GENLAYER_CONTRACT_ADDRESS=<operator contract>`
- `GENLAYER_SERVICE_PRIVATE_KEY=<funded service key from secret manager>`
- Browser wallet path, if tested: matching `NEXT_PUBLIC_GENLAYER_*` values.

## 2. DB migration readiness

Run against the target DB before deploy:

```bash
npx tsx scripts/check-duplicate-recovery-emails.ts
npx prisma migrate status
```

Expected:

- `No duplicate recoveryEmail values found.`
- Prisma reports the expected migration state.

If the duplicate scan fails, resolve non-owner `recoveryEmail` values before applying `20260528130000_unique_recovery_email`.

Apply migrations in staging/prod-like environments:

```bash
npm run db:deploy
```

Verify schema after deploy:

```bash
npx prisma migrate status
```

## 3. Local-safe wallet recovery smoke

With a local or disposable staging DB loaded in `DATABASE_URL`:

```bash
npx tsx scripts/smoke-wallet-recovery.ts
npx tsx scripts/smoke-wallet-recovery-browser.ts
```

Expected:

- Both scripts print `Wallet recovery smoke test passed.` / `Browser wallet recovery smoke test passed.`
- No real email is sent when `RESEND_API_KEY` is unset; OTPs are generated internally/logged.

For manual browser recovery, follow `docs/runbook/wallet-recovery-smoke-test.md`.

## 4. Stripe checkout + webhook smoke

Follow `docs/runbook/monetization-beta-smoke.md` sections 1-5.

Minimum staging pass criteria:

- Free comparison/watchlist/receipt baseline still works.
- Wallet + SIWE creates a wallet session cookie.
- Test checkout redirects to Stripe and returns to `/account?billing=success`.
- Webhook receives `checkout.session.completed` and subscription event(s).
- DB shows the test user on `plan = 'plus'` while active.
- Replayed event returns duplicate behavior and does not mutate plan twice.
- Billing portal cancellation returns user to Free when Stripe subscription is inactive.

## 5. GenLayer smoke

For configured Studionet service account:

```bash
npm run genlayer:smoke
```

Expected: tx hash, finalized/success execution, and `[smoke] OK`.

If the stable operator contract is unavailable because of Studio simulator state, run the ephemeral smoke instead:

```bash
npm run genlayer:smoke:ephemeral
```

Expected: deploy + smoke in one process with a generated in-memory key. This still requires `GENLAYER_NETWORK=studionet` and network access.

See `docs/runbook/genlayer-service-account.md` for top-up, rotation, and 503 recovery.

## 6. Final readiness sign-off

Record for the rollout ticket:

- Target host and commit SHA.
- `npx prisma migrate status` result.
- Duplicate recovery email scan result.
- Wallet recovery smoke result.
- Stripe checkout/webhook smoke result and test event ids.
- GenLayer smoke result and tx hash, or blocker.
- Any secrets still missing from the target environment.
