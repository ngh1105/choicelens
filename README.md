# ChoiceLens

ChoiceLens is a consumer web app for comparing almost anything: products, apps,
services, places, courses, and other everyday choices. It combines fast
comparison, shortlist reduction, personalized reasoning, saved watchlists, and
portable decision receipts anchored on GenLayer.

## Status

Built on Next.js 15 (App Router), React 19, TypeScript, Prisma + Postgres,
RainbowKit + wagmi, and Stripe.

What's shipped (master):

- **Comparison + receipts.** Core comparison flow with shortlist reduction,
  watchlists, and decision receipts persisted on GenLayer Studionet.
- **Visitor identity.** Anonymous users get a signed visitor cookie; no wallet
  needed to try the product.
- **V2 monetization beta.** Wallet-first paid identity. SIWE sign-in, HMAC-signed
  wallet session cookie, Stripe Checkout for the Plus monthly plan, Stripe
  Billing Portal, idempotent webhook plan sync, recovery-email contact, and
  primary-wallet rotation with fresh-signature confirm.

Local gates: `npm run lint`, `npm run typecheck`, `npm test` (280+).

## Quick start

```bash
npm install
cp .env.example .env.local            # fill in values you have
npm run db:generate
npm run db:deploy                     # apply Prisma migrations
npm run dev
```

Required for full functionality (see `.env.example` for the full list):

- `DATABASE_URL` — Postgres connection string.
- `APP_BASE_URL` — origin used for SIWE domain pinning and Stripe redirects.
- `WALLET_SESSION_SECRET` — long random value, required in production.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLUS_PRICE_ID` — to
  exercise the V2 paid path. Without them the Free flow keeps working.
- `NEXT_PUBLIC_WC_PROJECT_ID` — WalletConnect/RainbowKit. Optional in dev.

## Document Map

- [Master Product Spec](docs/superpowers/specs/2026-05-18-choice-lens-design.md)
- [V2 Monetization Beta — design](docs/superpowers/specs/2026-05-23-monetization-beta-design.md)
  · [plan](docs/superpowers/plans/2026-05-23-monetization-beta.md)
  · [smoke runbook](docs/runbook/monetization-beta-smoke.md)
- [Staging / prod-like smoke readiness checklist](docs/runbook/staging-prod-like-smoke-readiness.md)
- [Architecture 01: Web2-First, Wallet-Optional](docs/architecture/01-web2-first-wallet-optional.md)
- [Architecture 02: Wallet-First DApp](docs/architecture/02-wallet-first-dapp.md)
- [Architecture 03: API-First Comparison Engine](docs/architecture/03-api-first-comparison-engine.md)
- [SDK and GenLayer Integration Plan](docs/integrations/sdk-and-genlayer-integration.md)
- [V1 to Production Readiness Roadmap](docs/roadmap/v1-to-production-readiness.md)

## GenLayer Studionet ops

Phase 3B persists a decision receipt on GenLayer Studionet via a service account
(server-side) or the user's wallet. Operator procedures, env setup, smoke commands,
and `503` recovery live in the runbook.

- Runbook: [docs/runbook/genlayer-service-account.md](docs/runbook/genlayer-service-account.md)
- Architecture: [docs/architecture/05-phase3b-genlayer-integration.md](docs/architecture/05-phase3b-genlayer-integration.md)

```bash
npm run genlayer:deploy             # deploy ChoiceLensDecisionRegistry → copy address into env
npm run genlayer:smoke              # end-to-end check against the configured contract
npm run genlayer:smoke:ephemeral    # single-process deploy + smoke with an in-memory key
```
