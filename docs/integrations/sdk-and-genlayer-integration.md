# SDK and GenLayer Integration Plan

Date: 2026-05-18
Status: planning

## 1. Confirmed SDK Baseline

Checked package versions during planning:

- `genlayer-js`: 1.1.8
- `@rainbow-me/rainbowkit`: 2.2.11
- `wagmi`: 3.6.15
- `viem`: 2.49.3

These versions should be pinned during implementation and upgraded intentionally.

## 2. SDK Roles

### GenLayer

Use `genlayer-js` for:

- Creating GenLayer clients.
- Reading Intelligent Contract state.
- Writing transactions to Intelligent Contracts.
- Waiting for transaction receipts.
- Checking accepted/finalized transaction status.
- Checking execution result after finality.
- Debugging transaction execution where available.
- Switching wallet to the correct GenLayer network.

### Wallet UI

Use RainbowKit for:

- Wallet selection UI.
- Connect/disconnect state.
- Wallet and chain display.
- Network switching UX.
- WalletConnect support through project id.

### React Wallet State

Use wagmi for:

- `useAccount`
- `useConnect`
- `useDisconnect`
- `useSwitchChain`
- `useSignMessage` or SIWE integration.
- Wallet-aware React state.

### Low-Level EVM Utilities

Use viem for:

- Typed addresses and hashes.
- Wallet/public clients where needed.
- Signature utilities.
- ABI encoding/decoding if EVM contracts are added later.
- Type-safe primitives.

## 3. Recommended Install Set

```bash
npm install genlayer-js @rainbow-me/rainbowkit wagmi viem @tanstack/react-query
```

If SIWE is used:

```bash
npm install @rainbow-me/rainbowkit-siwe-next-auth next-auth
```

If fiat subscription is used:

```bash
npm install stripe
```

## 4. Wallet Connection Boundary

The app should provide a `WalletProvider` layer that wraps:

- `WagmiProvider`
- `QueryClientProvider`
- `RainbowKitProvider`

The rest of the app should not directly know about RainbowKit internals. It should
consume wallet state through app-level hooks:

- `useAppWallet()`
- `useRequireWalletAction()`
- `useConnectedAddress()`
- `useWalletNetworkStatus()`

This keeps wallet logic replaceable if the project later moves to Reown AppKit,
Privy, Magic, embedded wallets, or a custom wallet flow.

## 5. GenLayer Client Boundary

Create an app service named `GenLayerService`.

Responsibilities:

- Build read clients.
- Build wallet-backed write clients.
- Read decision receipt records.
- Submit receipt transactions.
- Wait for accepted/finalized receipts.
- Normalize SDK errors into app errors.

Suggested interface:

```ts
type CreateDecisionReceiptInput = {
  payloadHash: `0x${string}`;
  schemaVersion: string;
  category: string;
  recommendationHash: `0x${string}`;
  confidenceBand: "low" | "medium" | "high";
};

type DecisionReceiptStatus =
  | "not_submitted"
  | "pending"
  | "accepted"
  | "finalized"
  | "finalized_with_error"
  | "failed"
  | "timed_out";

interface GenLayerService {
  readDecisionReceipt(id: string): Promise<DecisionReceiptReadModel>;
  createDecisionReceipt(input: CreateDecisionReceiptInput): Promise<string>;
  waitForReceipt(hash: `0x${string}`): Promise<DecisionReceiptStatus>;
  ensureNetwork(networkName: GenLayerNetworkName): Promise<void>;
}
```

## 6. Client Creation Pattern

Use separate clients for reads and writes.

Read client:

- No wallet.
- Used by backend and frontend reads.
- Safe for polling and public receipt pages.

Write client:

- Requires wallet account and provider.
- Used only when the user intentionally writes.
- Must show UI context before wallet prompt.

Conceptual example:

```ts
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

export function createGenLayerReadClient() {
  return createClient({
    chain: testnetBradbury,
  });
}

export function createGenLayerWriteClient(address: `0x${string}`, provider: unknown) {
  return createClient({
    chain: testnetBradbury,
    account: address,
    provider,
  });
}
```

The exact provider type should be finalized during implementation against the
current `genlayer-js`, wagmi, and wallet provider APIs.

## 7. Receipt and Execution Result Pattern

Do not assume a finalized transaction means contract execution succeeded. The
integration should wait for the target status and then inspect execution result
fields before updating application state.

Conceptual flow:

```ts
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const receipt = await readClient.waitForTransactionReceipt({
  hash: txHash,
  status: TransactionStatus.FINALIZED,
  fullTransaction: false,
});

if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN) {
  await markReceiptFinalized(receipt);
} else if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
  await markReceiptFinalizedWithError(receipt);
} else {
  await markReceiptPendingExecution(receipt);
}
```

This avoids showing users a successful decision receipt when the transaction
finalized but the contract execution failed.

## 8. Network Plan

### Development

- Localnet for fast iteration.
- Mock GenLayer service for app tests.
- Real local/studio tests for contract behavior.

### Early Integration

- Studionet for manual integration and team demos.

### Public Beta

- Testnet Bradbury or Testnet Asimov.
- The final beta network should be confirmed immediately before deployment.

### Production

- Use the stable GenLayer network recommended by current official docs at launch
  time.

## 9. Intelligent Contract Design

Contract name: `ChoiceLensDecisionRegistry`.

Purpose:

- Store public-safe decision receipt digests.
- Allow users or app service accounts to record a decision result.
- Expose view methods for public receipt pages.
- Emit messages/events for accepted/finalized receipt creation.

### Stored Fields

- receipt id
- creator address
- payload hash
- schema version
- category
- recommendation hash
- confidence band
- created timestamp
- optional public summary hash

### Methods

- `create_receipt(...)`
- `get_receipt(receipt_id)`
- `get_user_receipts(address)`
- `mark_schema_version(...)` if admin-controlled schema registry is needed

### Data Excluded from Chain

- Raw prompt.
- User preference profile.
- Pasted URLs if private.
- Full evidence excerpts.
- Payment records.
- Email or social identity.
- Watchlist alert details.

## 10. GenLayer Job Types

### Receipt Job

Input:

- comparison payload hash,
- final recommendation hash,
- scoring schema version,
- public-safe category,
- confidence band.

Output:

- transaction hash,
- accepted/finalized status,
- contract receipt id.

### Consensus Decision Job

Input:

- normalized public-safe options,
- sanitized criteria,
- scoring schema.

Output:

- consensus result,
- score digest,
- explanation digest,
- transaction hash.

Use this only for paid/high-value requests until latency and cost are proven.

### Watchlist Reevaluation Job

Input:

- previous recommendation hash,
- changed signal digest,
- category,
- option ids.

Output:

- changed or unchanged decision,
- new recommendation hash if changed,
- receipt transaction if user plan supports it.

## 11. Error Handling

Normalize errors into:

- wallet_not_connected
- wallet_rejected
- wrong_network
- insufficient_funds
- genlayer_rpc_unavailable
- transaction_timeout
- transaction_failed
- receipt_not_finalized
- contract_schema_mismatch
- unknown_genlayer_error

UI should always show:

- what happened,
- whether the comparison result is still usable,
- whether the user was charged a credit,
- what action is available next.

## 12. Observability

Log:

- request id,
- user id,
- GenLayer network,
- contract address,
- transaction hash,
- transaction status,
- SDK error code,
- duration,
- retry count,
- cost estimate.

Do not log:

- raw private prompts by default,
- secrets,
- wallet signatures,
- billing tokens,
- full personal profiles.

## 13. Security Requirements

- Pin package versions.
- Review lockfile changes.
- Use Content Security Policy.
- Keep wallet transaction prompts explicit.
- Hash private payloads before receipt creation.
- Verify user owns a wallet before linking it to an account.
- Prevent replay for wallet-auth signatures.
- Rate-limit receipt creation.
- Add cost caps for GenLayer jobs.
- Keep server-side keys out of frontend bundles.

## 14. Integration Testing

Required tests:

- Read client can read a known contract.
- Write client handles wallet rejection.
- Wrong network produces a recoverable error.
- Receipt transaction reaches accepted status.
- Receipt transaction reaches finalized status when available.
- Finalized transaction with failed execution is stored as an error state.
- Failed transaction is visible in admin logs.
- Backend can resume polling after restart.
- Mock GenLayer service covers frontend CI tests.

## 15. References

- GenLayerJS official documentation: https://docs.genlayer.com/api-references/genlayer-js
- GenLayer DApp architecture overview: https://docs.genlayer.com/developers/decentralized-applications/architecture-overview
- GenLayer Intelligent Contracts introduction: https://docs.genlayer.com/developers
- GenLayer testing guide: https://docs.genlayer.com/developers/intelligent-contracts/testing
- RainbowKit installation: https://rainbowkit.com/en-US/docs/installation
- RainbowKit authentication: https://rainbowkit.com/en-US/docs/authentication
- wagmi official site: https://wagmi.sh
- viem getting started: https://viem.sh/docs/getting-started
