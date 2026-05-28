# Runbook — GenLayer service account

Operator-facing procedures for the server-side service account that drives the Phase 3B service path. Read alongside `docs/architecture/05-phase3b-genlayer-integration.md`.

## Account model

The service account is a single private key stored in `GENLAYER_SERVICE_PRIVATE_KEY`. It pays gas for every receipt submission via the service path. The wallet path uses the end user's wallet and does not consume this key.

If the key is unset, the service path returns `503 service_account_unavailable` and the frontend falls back to the off-chain receipt CTA.

## Verified operator deploy (Studionet)

Captured 2026-05-20 from `npm run genlayer:deploy` + `npm run genlayer:smoke`
against `https://studio.genlayer.com/api` with the runner-pinned contract
(commit `e02047e`). Use this as the canonical operator-owned contract until a
key rotation requires a fresh deploy.

| Field | Value |
| --- | --- |
| Service address (publishable) | `0x8Bd2B4e8B5860b09DbdF566D95e44D29c2c9E32c` |
| Deploy tx | `0x6e8a14ae19a9b5c5b432172569897f17b448fd613196f6437209f55bdc86bba` |
| Operator contract | `0xD7E2910DBbCb701992591b4285985a3Ad0e0A418` |
| Smoke tx (`create_receipt`) | `0xafee3bdcd4744e5933c00ad5bbace0d6f3ac01f561bfd6444570bb22f6c8f806` |
| Status | `FINALIZED` |
| Execution result | `SUCCESS` (`[smoke] OK`) |

The matching `GENLAYER_SERVICE_PRIVATE_KEY` lives only in the operator's secret
manager / local `.env` — never in this repo. To rotate, run the operator
checklist below end-to-end and only swap `GENLAYER_CONTRACT_ADDRESS` after
`npm run genlayer:smoke` reports `SUCCESS` against the new deploy.

## Operator checklist

For a fresh production / staging bring-up:

1. **Create a service account.** Generate a 32-byte key (kept out of the repo, kept out of `.env` committed to git):
   ```bash
   node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
   ```
   Store it directly in your hosting platform's secret manager. Never paste it into docs, issues, chat, or logs.
2. **Fund the account on Studionet.** Use the Studio dashboard faucet for the address derived from that key.
3. **Set the four server secrets** in the host:
   - `GENLAYER_NETWORK=studionet`
   - `GENLAYER_RPC_URL=https://studio.genlayer.com/api`
   - `GENLAYER_CONTRACT_ADDRESS=0xD7E2910DBbCb701992591b4285985a3Ad0e0A418`
   - `GENLAYER_SERVICE_PRIVATE_KEY=<from step 1>`
4. **Mirror the public values** for the browser bundle:
   - `NEXT_PUBLIC_GENLAYER_NETWORK=studionet`
   - `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS=0xD7E2910DBbCb701992591b4285985a3Ad0e0A418`
   - `NEXT_PUBLIC_GENLAYER_CHAIN_ID=...`
   - `NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api`
5. **Smoke test the live deploy:**
   ```bash
   npm run genlayer:smoke
   ```
   Expected: a tx hash, `statusName: FINALIZED`, `exec: SUCCESS` (or legacy `FINISHED_WITH_RETURN`), `[smoke] OK`.
6. **(Optional) single-process validation.** When you cannot rely on a stable Studio simulator, use the ephemeral variant — it deploys a fresh contract and smokes it in one process with an in-memory key:
   ```bash
   npm run genlayer:smoke:ephemeral
   ```
   The key is generated, used, and discarded. It is never written to disk.

## Studio simulator caveat

The Studio simulator is currently in-memory. A contract deployed in one process is not always visible to a fresh client in another process — `npm run genlayer:smoke` against a freshly deployed address can return `contract_not_found_handler` while the address is valid on the live network.

If you hit `contract_not_found_handler`:
- Re-run `npm run genlayer:smoke:ephemeral` to confirm the live network round-trip is healthy (deploy + write in one process).
- Verify `GENLAYER_CONTRACT_ADDRESS` matches a contract that was actually finalized on the network the runtime is talking to.

## Contract schema load failures

If Studio says "Could not load contract schema" or a deploy finalizes with
`invalid_contract`, inspect the GenVM log before changing storage layout. A log
like `:test/ :latest runner used in non-debug mode, this is not allowed` means
the `Depends` header is using an unstable runner channel. Studionet non-debug
deploys require the contract to pin a concrete `py-genlayer` runner hash.

## Rollback

The service path is non-fatal — degrading to off-chain receipts keeps the product usable while you triage.

- **Quick rollback to off-chain only**: set `GENLAYER_NETWORK=mock` (or unset `GENLAYER_SERVICE_PRIVATE_KEY`) and restart. The service path will return off-chain receipts and the wallet path UI will hide.
- **Production cache**: `resetServiceCache` is in-process only — across multiple instances, redeploy / restart so the genlayer-js singletons re-read the env.

## Top-up

1. Note the service address (`createAccount(privateKey).address` — printed by the deploy script and the smoke script).
2. Send GEN from the operator wallet or the Studio faucet.
3. Confirm with `npm run genlayer:smoke`.

## Rotating the key

1. Generate a new key, fund it, smoke test it locally with the new key in `.env.local` (network=studionet).
2. Roll the production env (`GENLAYER_SERVICE_PRIVATE_KEY`).
3. Restart the server so the wagmi/genlayer-js singletons pick up the new value (`resetServiceCache` is in-process only — a redeploy is required across instances).
4. Optional: drain the old account back to the operator wallet.

## Recovering from `503 service_account_unavailable`

The service path returns this when:
- the env is unset,
- the genlayer-js client failed to construct from the key, or
- the write factory threw before reaching `writeContract`.

Triage:
1. Confirm the four server envs are present in the runtime.
2. `npm run genlayer:smoke` — does it reproduce?
3. If smoke runs locally but production 503s, the deploy is missing the secret or the runtime cache is stale → restart.
4. If smoke also fails: the key is empty/malformed, the RPC is wrong, or the account is unfunded.

The frontend keeps showing the off-chain receipt while you triage — users are not blocked.

## Recovering from `503 genlayer_rpc_unavailable`

User-facing contract: receipt creation should fail clearly without crashing the comparison flow.

1. Confirm API shape from a safe client/test: `POST /api/comparisons/:id/receipt` should return `503` with `retryable: true`, a human-readable `message`, and `Retry-After: 60`. It should not persist a failed receipt row, so retrying later is safe.
2. Existing pending receipts remain visible: `GET /api/comparisons/:id/receipt` returns `200` with the last receipt plus `receiptError` during RPC outages.
3. Run `npm run genlayer:smoke` — does it reproduce?
4. If only smoke fails, check `GENLAYER_RPC_URL`, Studio status, and whether the pinned contract address is visible to the process.
5. If user writes are impacted for more than a short blip, flip the kill switch (`GENLAYER_NETWORK=mock`, restart/redeploy). New receipts become off-chain only while comparisons remain usable.
6. When Studio recovers, restore `GENLAYER_NETWORK=studionet`, restart/redeploy, and run `npm run genlayer:smoke:ephemeral` or `npm run genlayer:smoke` before re-enabling live writes.

The frontend keeps showing the off-chain receipt/comparison state while you triage — users are not blocked.

## Cost notes

Receipt writes are tiny but they happen per submitted comparison. Monitor the service account balance and alarm before it falls below ~10× the cost of a single receipt write. The wallet path moves cost to the user and does not affect this account.

## Secret hygiene

- Never paste a real `GENLAYER_SERVICE_PRIVATE_KEY` into docs, issues, PRs, chat, or logs.
- `.env` is gitignored. Use `.env.example` as the template — it carries no real secrets.
- Treat any key that has appeared in plaintext anywhere outside the secret manager as compromised; rotate it.

## Phase 3C — operator health endpoint

After Phase 3C ships, the operator can read the live health snapshot from
either an admin page or the JSON endpoint that backs it.

- Page: `GET /admin/genlayer` — server component, read-only, no controls.
- API: `GET /api/admin/genlayer/health` with header
  `Authorization: Bearer $ADMIN_API_TOKEN`. Missing token returns
  `503 admin_token_not_configured`; wrong/missing bearer returns `401`.

Safe fields the response/page exposes (and only these):

- `operatorState` (enum, see below) + `killSwitchActive` boolean.
- `network`, `contractAddressRedacted` (e.g. `0xD7E2…A418`),
  `serviceKeyPresent`, `serviceKeyFormatValid`, `serviceAddress` (derived
  from the key, OK to publish), `rpcUrlConfigured`.
- `counts24h` per status (`submitted`, `accepted`, `finalized`,
  `finalized_with_error`, `off_chain_only`, `failed`).
- `recentErrors` — last 5 receipt rows with `errorCode` in the last 24h.
- `lastSuccessfulAt`, `checkedAt`.

The endpoint never returns the value of `GENLAYER_SERVICE_PRIVATE_KEY`.

### Kill switch

Reuses the existing `GENLAYER_NETWORK` env var — there is no second
kill-switch variable. To disable the live receipt path:

1. Set `GENLAYER_NETWORK=mock` in the host's secret manager / env config.
2. Restart the server so the genlayer-js singletons re-read env.
3. Confirm the admin page reports `kill_switch_active` (yellow pill,
   "Kill switch active — receipts run off-chain.").

The wallet path UI hides automatically (still gated by
`isGenLayerWalletPathConfigured`), and the service path returns off-chain
receipts. Receipt rows already on-chain are unaffected.

### Operator state → action

| `operatorState` | Likely cause | Action |
| --- | --- | --- |
| `studionet_configured` | At least one finalized receipt in last 24h | None — healthy |
| `studionet_idle` | Studionet configured, no traffic in 24h | Run `npm run genlayer:smoke:ephemeral` |
| `studionet_unavailable` | `genlayer_rpc_unavailable` / `transaction_timeout` in last 24h | Run `npm run genlayer:smoke`; if persistent, check Studio status |
| `insufficient_funds` | Service account out of GEN | Top up (§Top-up) |
| `studionet_no_service_key` | Key missing or wrong format | Set `GENLAYER_SERVICE_PRIVATE_KEY`, restart |
| `contract_not_configured` | `GENLAYER_CONTRACT_ADDRESS` empty | Set address, restart |
| `kill_switch_active` | `GENLAYER_NETWORK=mock` after prior live use | Confirm intentional; flip back when ready |
| `mock` | Dev / staging baseline | None |

### Required env

- `ADMIN_API_TOKEN` — single bearer token, kept in the host's secret
  manager. Never paste into docs / chat / logs. Rotate by replacing the
  env value and restarting.
- All four `GENLAYER_*` server envs (already required by Phase 3B).
