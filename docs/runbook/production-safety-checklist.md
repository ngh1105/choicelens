# Production safety checklist

Use this before each beta/prod deploy and when changing auth, billing, comparison, receipt, or recovery flows.

## Observability

- Product events are emitted through `src/lib/analytics.ts` as structured `[analytics]` console logs.
- Current MVP events: `comparison_started`, `comparison_completed`, `saved_watchlist`, `receipt_created`, `upgrade_clicked`, `recovery_started`, `recovery_completed`, `result_helpful`, `result_unhelpful`.
- Keep event properties PII-light: IDs, counts, status, source. Do not log emails, wallet signatures, Stripe secrets, OTPs, private keys, raw comparison notes, or webhook payloads.
- Production log drain should preserve JSON console output and support filtering by `[analytics]` and API error prefix.
- Backlog: replace console sink with a real analytics provider or server `/api/events` collector once privacy requirements are settled.

## Rate limiting and abuse controls

Existing controls:

- Plan limits gate comparison, watchlist, service receipt, and wallet receipt creation.
- Recovery OTP verification has OTP attempt limiting in the recovery layer.
- Billing webhook verifies Stripe signatures.
- Admin GenLayer health requires an admin token.

Known gaps to close before public launch:

- Add IP/user rate limits for `POST /api/comparisons`, especially anonymous visitors.
- Add rate limits for SIWE nonce/verify: `POST /api/auth/siwe/nonce`, `POST /api/auth/siwe/verify`.
- Add request throttles for billing session creation: `POST /api/billing/checkout`, `POST /api/billing/portal`.
- Add explicit per-email/IP throttles around `POST /api/auth/recovery/request` and recovery challenge/confirm endpoints if not fully covered by DB-layer OTP limits.
- Add write throttles for receipt creation endpoints, even though plan limits exist, to reduce wallet/service path spam.
- Prefer shared storage (Redis/KV) in production; in-memory rate limiting is only acceptable for local/dev or single-instance beta.

## Deployment smoke

1. `npm run typecheck`
2. Targeted route/component tests for touched areas.
3. Create a comparison; confirm `comparison_started` and `comparison_completed` log lines.
4. Save watchlist; confirm `saved_watchlist` log line.
5. Build service/off-chain receipt; confirm `receipt_created` log line.
6. Click an upgrade CTA; confirm `upgrade_clicked` appears in browser/server logs available to the host.
7. Run wallet recovery smoke from `docs/runbook/wallet-recovery-smoke-test.md`; confirm started/completed events without logging email/code/signature.
8. Confirm bad requests return generic errors and do not expose secrets or raw provider payloads.

## Incident notes

- Analytics failures must never block user flows; keep hooks fire-and-forget.
- If logs contain sensitive data, disable export, rotate affected secrets, and scrub retained logs according to host policy.
- For GenLayer failures, follow `docs/runbook/genlayer-service-account.md`.
- For billing beta failures, follow `docs/runbook/monetization-beta-smoke.md`.
