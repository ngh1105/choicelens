# Phase 3B — GenLayer integration

Anchors decision receipts on GenLayer Studionet through two paths sharing one persisted row per comparison.

## Surface area

| Layer | Files |
| --- | --- |
| Contract | `contracts/ChoiceLensDecisionRegistry.py` |
| Module | `src/lib/genlayer/{types,errors,buildInput,client,service,mock,category,walletClient,index}.ts` |
| Persistence | `prisma/schema.prisma` `Receipt` model + `src/lib/store.ts` (`saveReceipt`, `getReceiptForComparison`, `updateReceiptStatus`) |
| Service path API | `src/app/api/comparisons/[id]/receipt/route.ts` (POST submit, GET lazy poll) |
| Wallet path API | `src/app/api/comparisons/[id]/receipt/build-input/route.ts`, `.../wallet-tx/route.ts` |
| Frontend | `src/components/receipt/{ReceiptCard,ReceiptStatusPill,WalletPathToggle,WalletReceiptControls}.tsx`, `src/lib/hooks/useReceiptPolling.ts` |
| Operator | `scripts/deploy-registry.ts`, `scripts/check-studionet.ts` |

Spec: `docs/superpowers/specs/2026-05-19-phase3b-genlayer-integration-design.md`.

## Path comparison

| | Service path | Wallet path |
| --- | --- | --- |
| Trigger | POST `/api/comparisons/[id]/receipt` | Toggle on + sign in `WalletReceiptControls` |
| Submitter | Server account from `GENLAYER_SERVICE_PRIVATE_KEY` | User wallet via wagmi |
| Tx hash source | `client.writeContract()` return | User-signed message (Phase 3B placeholder; on-chain write deferred until GenLayer MetaMask Snap) |
| `submitterKind` | `"service"` | `"user"` |
| Status refresh | GET poll calls `refreshReceiptStatus` until terminal | Same |

The two paths share the `Receipt` row (UNIQUE on `comparisonId`) — the latest write wins.

## Network matrix

`GENLAYER_NETWORK=mock` (default) returns an off-chain receipt: status `off_chain_only`, no tx, no polling. Studionet activates the live writeContract on the service path and unlocks the wallet path UI when public envs are present.

| `GENLAYER_NETWORK` | Service path | Wallet path UI | Polling |
| --- | --- | --- | --- |
| `mock` | builds off-chain receipt | hidden | off |
| `studionet` | live submit if service key set, else 503 `service_account_unavailable` | rendered when wallet connected | on while non-terminal |

## Env matrix

Server-side (do NOT expose to bundle):
- `GENLAYER_NETWORK` — `mock` | `studionet`
- `GENLAYER_CONTRACT_ADDRESS` — populated post-deploy
- `GENLAYER_SERVICE_PRIVATE_KEY` — required for service path
- `GENLAYER_RPC_URL` — Studionet endpoint

Browser-side (mirror of server values; safe to expose):
- `NEXT_PUBLIC_GENLAYER_NETWORK`
- `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_GENLAYER_CHAIN_ID`
- `NEXT_PUBLIC_GENLAYER_RPC_URL`

`isGenLayerWalletPathConfigured` in `src/lib/wallet.ts` gates the wallet UI on these mirror values.

## Error model

`GenLayerError` codes (`src/lib/genlayer/errors.ts`) map to HTTP via `HTTP_STATUS_BY_CODE`. Notable:
- `service_account_unavailable` (503) — service path, no key.
- `genlayer_rpc_unavailable` (503) — RPC down.
- `transaction_timeout` (502) — surfaced to the GET handler, swallowed (returns existing row 200) so the off-chain result remains usable.
- `wallet_not_connected` (400) — wallet-tx route, missing `transactionHash` or `creatorAddress`.
- `wallet_rejected` (400) — wallet-tx route, malformed hex.

## Execution result mapping

`service.ts` treats both `SUCCESS` and `FINISHED_WITH_RETURN` as a finalized successful write (PR #11 — the live Studio runtime returns `SUCCESS` for create_receipt while the older simulator returns `FINISHED_WITH_RETURN`). Anything else is surfaced to the caller as a transaction failure rather than silently mapped to success.

## Operator scripts

```bash
npm run genlayer:deploy            # one-shot contract deploy → operator copies address into .env
npm run genlayer:smoke              # end-to-end studionet check (requires service key + contract addr)
npm run genlayer:smoke:ephemeral    # single-process deploy + smoke with an in-memory key (never persisted)
```

`scripts/deploy-and-smoke-ephemeral.ts` is a one-shot variant that generates a temporary
private key in-process for ad-hoc Studionet validation; it never writes the key to disk.

See `docs/runbook/genlayer-service-account.md` for top-up, rotation, and `503` recovery. The current canonical operator-owned Studionet contract is `0xD7E2910DBbCb701992591b4285985a3Ad0e0A418` (deploy tx `0x6e8a14ae19a9b5c5b432172569897f17b448fd613196f6437209f55bdc86bba`, smoke tx `0xafee3bdcd4744e5933c00ad5bbace0d6f3ac01f561bfd6444570bb22f6c8f806`, both `FINALIZED` / `SUCCESS`).

## Contract storage notes

`ChoiceLensDecisionRegistry.py` uses GenVM-friendly types only:
- The contract pins `py-genlayer` to a concrete runner hash in the `Depends`
  header. Studionet non-debug deploys reject `:test` / `:latest` runners with
  `invalid_contract` before schema generation.
- `@allow_storage @dataclass` for the `Receipt` struct (custom storage classes must be both).
- Hash fields are `str` (`0x`-prefixed hex). The runtime's `bytes` storage codec rejects
  Python `str`, and genlayer-js sends hex args as Python `str`, so we keep the wire type aligned.
- `by_user` is `TreeMap[Address, TreeMap[str, bool]]` (set semantics) — `DynArray[str]` nested
  inside a `TreeMap` failed to deploy on Studionet with `invalid_contract`.
- `created_at` uses `time.time()` (transaction-deterministic) since `gl.block` was removed.
- Empty `public_summary_hash` is the empty string `""`, not `null`.
