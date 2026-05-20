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

Studionet RPC blip. Verify with `curl $GENLAYER_RPC_URL` or run the smoke script. No app-side action needed once RPC returns; the GET handler will resume status refresh on the next poll cycle.

## Cost notes

Receipt writes are tiny but they happen per submitted comparison. Monitor the service account balance and alarm before it falls below ~10× the cost of a single receipt write. The wallet path moves cost to the user and does not affect this account.

## Secret hygiene

- Never paste a real `GENLAYER_SERVICE_PRIVATE_KEY` into docs, issues, PRs, chat, or logs.
- `.env` is gitignored. Use `.env.example` as the template — it carries no real secrets.
- Treat any key that has appeared in plaintext anywhere outside the secret manager as compromised; rotate it.

## Phase 3C (planned)

The Phase 3C design — operator observability, kill switch semantics, smoke
result interpretation — is in `docs/superpowers/specs/2026-05-20-phase3c-genlayer-ops-design.md`.
Phase 3C ships only after this runbook's operator checklist is complete in
production.
