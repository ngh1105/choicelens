# Runbook — GenLayer service account

Operator-facing procedures for the server-side service account that drives the Phase 3B service path. Read alongside `docs/architecture/05-phase3b-genlayer-integration.md`.

## Account model

The service account is a single private key stored in `GENLAYER_SERVICE_PRIVATE_KEY`. It pays gas for every receipt submission via the service path. The wallet path uses the end user's wallet and does not consume this key.

If the key is unset, the service path returns `503 service_account_unavailable` and the frontend falls back to the off-chain receipt CTA.

## Initial setup

1. Generate a new account.
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Prefix with `0x`. Keep this value in a secret manager — never commit it.
2. Fund the account from a Studionet faucet. Note the faucet URL on the GenLayer Studio dashboard.
3. Set the four server envs in production:
   - `GENLAYER_NETWORK=studionet`
   - `GENLAYER_SERVICE_PRIVATE_KEY=0x...`
   - `GENLAYER_RPC_URL=...` (Studionet endpoint)
   - `GENLAYER_CONTRACT_ADDRESS=...` (from `npm run genlayer:deploy`)
4. Mirror the public values for the browser bundle:
   - `NEXT_PUBLIC_GENLAYER_NETWORK=studionet`
   - `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS=...`
   - `NEXT_PUBLIC_GENLAYER_CHAIN_ID=...`
   - `NEXT_PUBLIC_GENLAYER_RPC_URL=...`
5. Smoke test:
   ```bash
   npm run genlayer:smoke
   ```
   Expected: a tx hash, `statusName: FINALIZED`, `exec: SUCCESS` (or legacy `FINISHED_WITH_RETURN`), `[smoke] OK`.

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
