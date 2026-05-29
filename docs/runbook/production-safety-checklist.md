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
- The rate-limit backend is pluggable (`setRateLimitBackend` / `RateLimitBackend`). When `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, `src/lib/rateLimit.bootstrap.ts` swaps in the Upstash REST backend (`src/lib/rateLimit.upstash.ts`), which is correct across multi-instance / serverless deploys. Both vars unset = the in-memory backend.
- `applyApiRateLimit` fails open: if the active backend throws (e.g. Upstash REST timeout/5xx) the request is allowed (`limited: false`) and a `[apiRateLimit] ... failing open` warning is logged. Rate limiting is defense in depth, not a critical path — a degraded Redis must never lock users out of auth/recovery flows.
- Billing webhook verifies Stripe signatures.
- Admin GenLayer health requires an admin token.

Known gaps to close before public launch:

- **Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in every multi-instance / serverless environment.** The shared Upstash backend now exists (`src/lib/rateLimit.upstash.ts`) but is opt-in; with the vars unset, serverless cold starts and horizontal scale make the in-memory limiter effectively a no-op (each instance keeps its own counter).
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
9. In staging/prod, confirm `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set so rate limits are shared across instances; a missing pair silently falls back to per-instance in-memory limits. Optionally confirm a forced backend error logs `failing open` rather than returning 500.

## Incident notes

- Analytics failures must never block user flows; keep hooks fire-and-forget.
- If logs contain sensitive data, disable export, rotate affected secrets, and scrub retained logs according to host policy.
- For GenLayer failures, follow `docs/runbook/genlayer-service-account.md`.
- For billing beta failures, follow `docs/runbook/monetization-beta-smoke.md`.
