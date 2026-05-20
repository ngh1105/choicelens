# ChoiceLens

Working name: ChoiceLens.

ChoiceLens is a consumer web app concept for comparing almost anything: products,
apps, services, places, courses, and other everyday choices. The product combines
fast comparison, shortlist reduction, personalized reasoning, and saved watchlists.

This repository currently contains planning documents only. No application code
has been scaffolded yet.

## Document Map

- [Master Product Spec](docs/superpowers/specs/2026-05-18-choice-lens-design.md)
- [Architecture 01: Web2-First, Wallet-Optional](docs/architecture/01-web2-first-wallet-optional.md)
- [Architecture 02: Wallet-First DApp](docs/architecture/02-wallet-first-dapp.md)
- [Architecture 03: API-First Comparison Engine](docs/architecture/03-api-first-comparison-engine.md)
- [SDK and GenLayer Integration Plan](docs/integrations/sdk-and-genlayer-integration.md)
- [V1 to Production Readiness Roadmap](docs/roadmap/v1-to-production-readiness.md)

## Current Recommendation

The recommended path is Architecture 01: Web2-first, wallet-optional.

Reason: it best matches the goal of serving broad consumer users while still using
GenLayer where it creates clear differentiation: multi-agent decision consensus,
portable decision receipts, and optional wallet-backed ownership of premium
preferences or saved decisions.

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
