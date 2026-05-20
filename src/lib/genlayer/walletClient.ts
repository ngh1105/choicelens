"use client";

import { createClient } from "genlayer-js";
import type { CreateDecisionReceiptInput } from "./types";

interface BuildInputResponse {
  input: CreateDecisionReceiptInput;
  contractAddress: string | null;
  network: string;
}

interface WalletWriteOptions {
  account: `0x${string}`;
  // wagmi `getWalletClient`/`useConnectorClient` shapes; we pass the EIP-1193
  // provider so genlayer-js can sign + broadcast.
  provider: unknown;
  rpcUrl?: string;
  chainId: number;
}

/**
 * Browser-side helper. Creates a write-capable genlayer-js client bound to
 * the user's wallet provider, and submits `create_receipt` against the
 * server-supplied contract address with server-derived args.
 *
 * Returns the transaction hash. The caller is responsible for posting the
 * hash + creator address back to /api/comparisons/[id]/receipt/wallet-tx.
 */
export async function submitReceiptWithWallet(
  buildInput: BuildInputResponse,
  options: WalletWriteOptions,
): Promise<`0x${string}`> {
  const { account, provider, rpcUrl, chainId } = options;
  if (!buildInput.contractAddress) {
    throw new Error("contract_not_configured");
  }
  // chainId is sourced from NEXT_PUBLIC_GENLAYER_CHAIN_ID and validated by the
  // wagmi config layer, so we just thread it into the genlayer-js client.
  const client = createClient({
    chain: {
      id: chainId,
      name: "GenLayer Studionet",
      nativeCurrency: { name: "Gen", symbol: "GEN", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl ?? ""] } },
    } as never,
    account,
    provider: provider as never,
    endpoint: rpcUrl,
  });

  const i = buildInput.input;
  // Match the contract argument order used by the server-side service
  // (see src/lib/genlayer/service.ts -> createDecisionReceipt).
  const txHash = (await (client as unknown as {
    writeContract: (args: {
      address: `0x${string}`;
      functionName: string;
      args: unknown[];
      value: bigint;
    }) => Promise<`0x${string}`>;
  }).writeContract({
    address: buildInput.contractAddress as `0x${string}`,
    functionName: "create_receipt",
    args: [
      i.receiptId,
      `0x${i.payloadHash}`,
      i.schemaVersion,
      i.category,
      `0x${i.recommendationHash}`,
      i.confidenceBand,
      i.publicSummaryHash ? `0x${i.publicSummaryHash}` : "",
    ],
    value: 0n,
  })) as `0x${string}`;

  return txHash;
}
