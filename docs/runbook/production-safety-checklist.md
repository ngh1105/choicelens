# Production safety checklist

Use this before each beta/prod deploy and when changing auth, billing, comparison, receipt, or recovery flows.

## Observability

- Product events are emitted through `src/lib/analytics.ts` as structured `[analytics]` console logs.
- Current MVP events: `comparison_started`, `comparison_completed`, `saved_watchlist`, `receipt_created`, `upgrade_clicked`, `recovery_started`, `recovery_completed`, `result_helpful`, `result_unhelpful`.
- Server-side errors are emitted through `src/lib/requestLog.ts` as structured `[request_error]` console logs and forwarded via `src/lib/observability.ts` to Sentry (when `globalThis.Sentry` is wired) and/or to `LOG_DRAIN_URL` if set.
- Each error log includes a stable `requestId` propagated from `x-request-id` / `x-vercel-id` (generated when missing) so user-facing errors can be cross-referenced in logs.
- Keep event/error properties PII-light: IDs, counts, status, source. Do not log emails, wallet signatures, Stripe secrets, OTPs, private keys, raw comparison notes, or webhook payloads.
- Production log drain should preserve JSON console output and support filtering by `[analytics]` and `[request_error]` prefixes.
- Backlog: replace console sink with a real analytics provider or server `/api/events` collector once privacy requirements are settled; bind a real Sentry client when ready.

## Rate limiting and abuse controls

Existing controls:

- Plan limits gate comparison, watchlist, service receipt, and wallet receipt creation.
- Recovery OTP verification has OTP attempt limiting in the recovery layer.
- Recovery challenge endpoint has IP+token in-memory rate limiting (`recovery-challenge:*`).
- `POST /api/comparisons`, `POST /api/comparisons/[id]/feedback`, `POST /api/auth/siwe/nonce`, `POST /api/auth/siwe/verify`, and `POST /api/billing/checkout` have per-IP+user in-memory rate limits via `src/lib/apiRateLimit.ts`.
- Billing webhook verifies Stripe signatures.
- Admin GenLayer health requires an admin token.

Known gaps to close before public launch:

- Replace the in-memory backend in `src/lib/apiRateLimit.ts` with a shared Redis/Upstash backend before multi-instance deploys; serverless cold starts and horizontal scale make in-memory effectively a no-op at scale. Use `setRateLimitBackend` to swap.
- Add request throttles for `POST /api/billing/portal` and the watchlist/receipt write endpoints; plan limits help but do not bound burst abuse.
- Add explicit per-email/IP throttles around `POST /api/auth/recovery/request` and recovery confirm endpoints if not fully covered by DB-layer OTP limits.
- Consider middleware-level guards (Edge runtime) so rate limit responses arrive before per-route work.

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
