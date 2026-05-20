# Phase 3C — GenLayer Ops Readiness (Design)

Date: 2026-05-20
Status: design / not implemented
Owner: project founder
Depends on: Phase 3B (`docs/architecture/05-phase3b-genlayer-integration.md`,
`docs/runbook/genlayer-service-account.md`)

## 1. Summary

Phase 3C makes the GenLayer integration **operable in production**: an operator
can see, at a glance, whether the live receipt path is healthy, can flip the
service back to off-chain-only without a redeploy, and can interpret a smoke
result into a known recovery procedure.

No new contract work, no new on-chain features. This phase is observability,
a kill switch, and the operator-facing surface around the existing Phase 3B
service path.

## 2. Problem / why now

Phase 3B is functionally complete: the service path writes receipts on
Studionet, the wallet path is gated on public envs, and degradation to
off-chain receipts works. What's missing for production:

- **Visibility**: no in-product view of receipt failures. Operators must read
  app logs to know whether the integration is healthy.
- **Kill switch ergonomics**: the runbook says to set `GENLAYER_NETWORK=mock`
  and restart. There is no in-process consequence of an env change without a
  restart, and no way to confirm the change took effect.
- **Health interpretation**: `npm run genlayer:smoke` produces a JSON blob.
  Operators need a small decision tree from result to action.

These gaps block "Admin can disable GenLayer receipt creation if network
issues occur" — a launch-readiness exit criterion in
`docs/roadmap/v1-to-production-readiness.md` §7.

## 3. Non-goals

- No new on-chain features. The contract, ABI, and write path stay frozen.
- No multi-account / role-based admin system. A single bearer-token
  protected route is sufficient for V1.
- No metrics push to an external system (Datadog, Honeycomb). Health is
  surfaced in-product; external metrics are Phase 6.
- No automatic kill switch (circuit breaker reacting to error rate).
  Operators flip the switch deliberately. Auto-degradation is a follow-up.
- No alerting / paging integration.

## 4. Operator prerequisites

Phase 3C ships only after the Phase 3B runbook §"Operator checklist" is
complete in production:

1. Funded service key in the secret manager.
2. Four server envs + four `NEXT_PUBLIC_*` mirrors set.
3. `npm run genlayer:smoke` returns `[smoke] OK` against the configured
   contract.

Without (3), Phase 3C ships disabled (the admin view will display
`studionet_unavailable` or `contract_not_configured`).

## 5. Proposed UX/API

### 5.1 Admin health endpoint

`GET /api/admin/genlayer/health`

Authentication: `Authorization: Bearer <ADMIN_API_TOKEN>`. The token is a
single env-configured secret. Missing/wrong token → 401.

Response shape (JSON):

```jsonc
{
  "operatorState": "studionet_configured",   // see §9
  "network": "studionet",                     // process.env.GENLAYER_NETWORK
  "contractAddress": "0x8c05…a770",           // first 6 + last 4, redacted
  "serviceKeyPresent": true,                  // boolean ONLY, never the value
  "rpcUrl": "https://studio.genlayer.com/api",
  "killSwitchActive": false,                  // see §8
  "counts24h": {                              // last 24h, grouped by status
    "submitted": 12,
    "accepted": 10,
    "finalized": 9,
    "off_chain_only": 3,
    "failed": 2
  },
  "recentErrors": [                           // last 5 receipt rows w/ errorCode
    {
      "comparisonId": "cmp_abc123",
      "errorCode": "transaction_timeout",
      "createdAt": "2026-05-20T15:42:00Z"
    }
  ],
  "lastSuccessfulAt": "2026-05-20T15:55:01Z"  // most recent finalized row
}
```

The endpoint never returns `GENLAYER_SERVICE_PRIVATE_KEY` content.

### 5.2 Admin page

`GET /admin/genlayer` — server component that fetches the health endpoint
and renders four cards: **Operator state**, **Counts (24h)**, **Recent
errors**, **Configuration** (network, redacted contract, service-key
present, kill-switch banner).

Single page, no interactive controls in V1. The kill switch is operator-set
via env (§8); the page reflects it but does not toggle it.

## 6. Data model impacts

**No schema change.** The existing `Receipt` model
(`prisma/schema.prisma`) already carries everything Phase 3C needs:

- `status` — drives the `counts24h` aggregation.
- `errorCode` — drives `recentErrors`.
- `executionResult` — disambiguates `finalized` vs `finalized_with_error`.
- `network`, `submitterKind`, `createdAt` — already populated.
- `updatedAt` — drives `lastSuccessfulAt`.

If a follow-up phase needs cross-comparison aggregates that the `Receipt`
shape can't answer, a separate `OpsEvent` table can be added then. Don't
add it speculatively.

## 7. Backend changes

Module surface (planned files):

- `src/lib/genlayer/health.ts` — pure function
  `computeOperatorState(env, recentReceipts)` returning a
  `{ operatorState, killSwitchActive, ... }` snapshot. No I/O.
- `src/lib/genlayer/redact.ts` — `redactAddress`, `summariseServiceKey`.
- `src/app/api/admin/genlayer/health/route.ts` — auth check + DB read +
  call into `computeOperatorState`.
- `src/app/admin/genlayer/page.tsx` — server component.
- `src/lib/admin/auth.ts` — `requireAdminToken(request)` shared helper.

The existing `getGenLayerService` and route handlers are **not modified**.
Phase 3C reads from the same `Receipt` rows the service path writes. The
kill switch piggy-backs on the existing `GENLAYER_NETWORK` lookup (§8).

## 8. Kill switch behavior

**Decision: reuse `GENLAYER_NETWORK=mock` as the kill switch. No new env
var.**

Justification:
- `getGenLayerService` already returns `MockGenLayerService` for
  `GENLAYER_NETWORK=mock`. The behavior is implemented, tested, and
  understood. A second env var (`GENLAYER_FORCE_MOCK=true`) would create
  ambiguity if the two disagree, doubling the test matrix without adding
  expressiveness.
- Phase 3B runbook already documents this rollback step. Operators have
  one lever to learn.

The admin view labels it explicitly:

- `network = "mock"` and the system was previously running on `studionet`
  → `killSwitchActive: true` is reported (heuristic: any finalized receipt
  on `studionet` exists in the DB but env is now `mock`).
- `network = "mock"` and no historical `studionet` receipts exist →
  `killSwitchActive: false`, `operatorState: "mock"`. Fresh dev/staging.

When `network = "mock"`:
- Service path returns off-chain receipt (existing behavior).
- Wallet path UI hides (existing behavior — gated by
  `isGenLayerWalletPathConfigured`).
- The admin page displays a yellow banner: "Kill switch active —
  off-chain receipts only".

**Cache caveat**: `getGenLayerService` caches the resolved service per
process. Flipping `GENLAYER_NETWORK` requires either a redeploy/restart
**or** an in-process call to `resetServiceCache()`. Phase 3C exposes
neither admin endpoint to call `resetServiceCache` (avoid auth surface)
and recommends restart. The runbook already says this; the admin page
will reiterate.

## 9. Health / status semantics

`operatorState` is a single derived enum the admin page uses to drive
its summary card. Computed top-down — first match wins.

| State                       | Trigger                                                                                  | Operator action |
| --------------------------- | ---------------------------------------------------------------------------------------- | --------------- |
| `mock`                      | `GENLAYER_NETWORK=mock` (or unset) and no historical `studionet` receipts                | None — dev mode |
| `kill_switch_active`        | `GENLAYER_NETWORK=mock` AND prior `studionet` receipts exist                             | Confirm intentional rollback (runbook §"Rollback") |
| `contract_not_configured`   | `GENLAYER_NETWORK=studionet` AND `GENLAYER_CONTRACT_ADDRESS` empty                       | Set env, restart |
| `studionet_no_service_key`  | `GENLAYER_NETWORK=studionet` AND service key env empty                                   | Add to secret manager, restart |
| `insufficient_funds`        | `GENLAYER_NETWORK=studionet` AND any `errorCode = "insufficient_funds"` in last 24h      | Top up service account (runbook §"Top-up") |
| `studionet_unavailable`     | `GENLAYER_NETWORK=studionet` AND any `errorCode IN ("genlayer_rpc_unavailable", "transaction_timeout")` in last 24h | Run smoke; if RPC blip, wait + monitor |
| `studionet_configured`      | `GENLAYER_NETWORK=studionet` AND none of the above AND a successful finalized receipt in the last 24h | None — healthy |
| `studionet_idle`            | `GENLAYER_NETWORK=studionet` AND none of the above AND no traffic in 24h                 | Run `npm run genlayer:smoke:ephemeral` to confirm reachability |

Smoke result interpretation (added to runbook):

| Smoke output                                              | Operator state implied   | Action |
| --------------------------------------------------------- | ------------------------ | ------ |
| `[smoke] OK`                                              | `studionet_configured`   | Done |
| `service_account_unavailable`                             | `studionet_no_service_key` | Set env, restart |
| `genlayer_rpc_unavailable` / connect refused              | `studionet_unavailable`  | Wait; verify RPC URL |
| `insufficient funds`                                      | `insufficient_funds`     | Top up |
| `contract_not_found_handler` (deploy in different proc)   | Studio simulator quirk   | Run `npm run genlayer:smoke:ephemeral` |
| `contract_not_configured`                                 | `contract_not_configured` | Set `GENLAYER_CONTRACT_ADDRESS` |

## 10. Frontend / admin changes

Server component at `/admin/genlayer`:

- Reads `ADMIN_API_TOKEN` from env on the server side; calls
  `/api/admin/genlayer/health` with that token. The page itself does not
  expose the token to the browser.
- Renders four cards:
  1. **Operator state** — colored pill (green / yellow / red) + one-line
     remediation copied from the table in §9.
  2. **Configuration** — `network`, redacted `contractAddress`,
     `serviceKeyPresent: yes/no`, `rpcUrl`, `killSwitchActive`.
  3. **Counts (24h)** — six numbers: submitted / accepted / finalized /
     finalized_with_error / off_chain_only / failed.
  4. **Recent errors** — last 5, with `comparisonId`, `errorCode`,
     timestamp.
- No actions, no buttons. Read-only.

The page is **not** linked from the main user nav.

## 11. Security / privacy

- **Auth**: bearer token in a header. Token stored only in the secret
  manager. Wrong/missing → 401, no body. Constant-time string comparison.
- **No PII**: the page exposes `comparisonId` (already in the URL path of
  the existing API), receipt counts, error codes, and a redacted contract
  address. No user identifiers, no payload bodies.
- **Service key**: never returned, never logged. Reported as a boolean
  presence flag derived from `process.env.GENLAYER_SERVICE_PRIVATE_KEY`
  being non-empty.
- **Contract address**: redacted in the response (`0x8c05…a770`). The full
  value is already public on-chain; redaction is for log hygiene, not
  secrecy.
- **CSRF**: route is GET-only with bearer-token auth, so no CSRF surface.
  No POST/mutating endpoints in Phase 3C.
- **Rate limit**: deferrable. Operator-only endpoint behind a single
  long-lived token; abuse risk is low. Add when public Phase 6 hardening
  lands.

## 12. Test plan

**No live network in CI.** Every test stubs `process.env` and the Prisma
client at the seam (existing pattern in
`src/lib/genlayer/__tests__/service.test.ts`).

Unit tests:

- `health.test.ts` — `computeOperatorState` for every state in §9, edge
  cases for empty receipt history, env transitions.
- `redact.test.ts` — `redactAddress` length / format, `summariseServiceKey`
  never returns the value.
- `auth.test.ts` — `requireAdminToken` accepts a matching token, rejects
  missing / wrong / case-mutated tokens; constant-time path covered.

Route tests (Vitest, mock Prisma):

- `app/api/admin/genlayer/health/route.test.ts` — 401 without token, 401
  with wrong token, 200 with correct token, payload shape matches §5.1.
- Verify response NEVER contains `GENLAYER_SERVICE_PRIVATE_KEY` value
  via a regex assertion against the serialized JSON.

Component test:

- `admin/genlayer/page.test.tsx` — renders each operator state with the
  correct pill color and remediation copy.

CI gates: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm test`. Same gates as Phase 3B.

## 13. Rollout / rollback

Rollout order (no flag — code is gated by env presence and admin auth):

1. **Operator smoke first.** Phase 3C does not ship until Phase 3B's
   `npm run genlayer:smoke` returns `[smoke] OK` in production.
2. **Staged enablement.**
   - Stage 1: deploy with `GENLAYER_NETWORK=mock` and `ADMIN_API_TOKEN`
     set. Admin page renders the `mock` state. Confirm route auth.
   - Stage 2: flip `GENLAYER_NETWORK=studionet` (with the four service
     envs already in place). Restart. Watch admin page for
     `studionet_configured` after first real receipt.
3. **Monitor for 24h.** Watch `recentErrors` and `counts24h.failed`.
   Investigate any `errorCode` other than `transaction_timeout` (timeouts
   can be expected single-event RPC blips).

Rollback:

- **Phase 3C only**: remove `ADMIN_API_TOKEN`. Admin page returns 401 but
  the user-facing receipt path is untouched.
- **Receipt path**: set `GENLAYER_NETWORK=mock`, restart. Admin page
  reports `kill_switch_active`. Off-chain receipts continue. No data loss
  — `Receipt` rows already-on-chain remain on-chain.

## 14. Acceptance criteria

- [ ] Admin route returns 401 without token, 200 with token.
- [ ] Admin page renders all eight `operatorState` enum values with
      correct remediation copy (covered by component test).
- [ ] No test, log line, or response includes the value of
      `GENLAYER_SERVICE_PRIVATE_KEY`.
- [ ] Setting `GENLAYER_NETWORK=mock` after a successful Studionet write
      makes the admin page report `kill_switch_active`.
- [ ] All Phase 3B tests still pass unchanged.
- [ ] Runbook updated with §9 smoke-result table.
- [ ] No new Prisma migration in this phase.

## 15. Open questions

1. **Admin token vs Next.js middleware vs NextAuth.** A bearer token is
   simplest. NextAuth becomes worth it only when the app has more than
   one admin endpoint. Defer the decision until Phase 4 brings more.
2. **Should `kill_switch_active` auto-clear?** The current heuristic
   ("seen prior studionet receipts") never auto-clears once a real
   receipt has been written. Adequate for V1. If the Receipt table is
   ever wiped (DR exercise), the indicator regresses to `mock` —
   acceptable.
3. **Time window for "last 24h".** 24h is an arbitrary first cut. Could
   be a query param. Defer to operator feedback.
4. **Off-chain receipt visibility**. `off_chain_only` is reported as a
   count, not as errors. If operators want to track *intentional*
   off-chain results separately from kill-switched off-chain results, we
   need a `submitterKind` filter in the count. Defer until asked.
5. **Studio simulator caveat.** A `contract_not_found_handler` after a
   real deploy is a Studio bug, not an app bug. Phase 3C reports it as
   `studionet_unavailable`; the runbook tells operators to retry with
   `genlayer:smoke:ephemeral`. If Studio fixes the simulator, this row
   becomes dead code — fine.
