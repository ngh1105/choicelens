import type { ComparisonResult } from "../comparison";
import { createReadClient, createServiceWriteClient } from "./client";
import { GenLayerError, isGenLayerError } from "./errors";
import { MockGenLayerService } from "./mock";
import type { CreateDecisionReceiptInput, DecisionReceipt } from "./types";

type ClientLike = {
  account?: { address: string };
  writeContract?: (args: {
    address: `0x${string}`;
    functionName: string;
    args?: unknown[];
    value: bigint;
    leaderOnly?: boolean;
  }) => Promise<unknown>;
  waitForTransactionReceipt?: (args: {
    hash: `0x${string}`;
    status?: string;
    interval?: number;
    retries?: number;
  }) => Promise<{
    consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> };
  }>;
};

type ReadFactory = () => ClientLike;
type WriteFactory = () => ClientLike;

export interface GenLayerService {
  isAvailable(): boolean;
  buildReceipt(result: ComparisonResult): DecisionReceipt;
  createDecisionReceipt?(input: CreateDecisionReceiptInput): Promise<{ transactionHash: string; creatorAddress: string }>;
  refreshReceiptStatus?(transactionHash: string): Promise<{ status: string; executionResult: string | null }>;
}

export class GenLayerServiceImpl implements GenLayerService {
  constructor(
    private readonly contractAddress: string,
    private readonly readFactory: ReadFactory = createReadClient as ReadFactory,
    private readonly writeFactory: WriteFactory = createServiceWriteClient as WriteFactory,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  buildReceipt(result: ComparisonResult): DecisionReceipt {
    return {
      id: `rcpt_${result.receiptPayloadHash.slice(0, 8)}`,
      payloadHash: result.receiptPayloadHash,
      status: "pending",
      network: "studionet",
      contractAddress: this.contractAddress,
      transactionHash: null,
      createdAt: new Date().toISOString(),
    };
  }

  async createDecisionReceipt(
    input: CreateDecisionReceiptInput,
  ): Promise<{ transactionHash: string; creatorAddress: string }> {
    let client: ClientLike;
    try {
      client = this.writeFactory();
    } catch (err) {
      if (isGenLayerError(err)) throw err;
      throw new GenLayerError("service_account_unavailable", "could not init write client", { cause: err });
    }
    if (!client.writeContract || !client.account) {
      throw new GenLayerError("service_account_unavailable", "write client missing writeContract/account");
    }
    try {
      const hash = await client.writeContract({
        address: this.contractAddress as `0x${string}`,
        functionName: "create_receipt",
        args: [
          input.receiptId,
          `0x${input.payloadHash}`,
          input.schemaVersion,
          input.category,
          `0x${input.recommendationHash}`,
          input.confidenceBand,
          input.publicSummaryHash ? `0x${input.publicSummaryHash}` : "",
        ],
        value: 0n,
      });
      return { transactionHash: String(hash), creatorAddress: client.account.address };
    } catch (err) {
      if (isGenLayerError(err)) throw err;
      throw mapWriteError(err);
    }
  }

  async refreshReceiptStatus(
    transactionHash: string,
  ): Promise<{ status: string; executionResult: string | null }> {
    const client = this.readFactory();
    if (!client.waitForTransactionReceipt) {
      throw new GenLayerError("genlayer_rpc_unavailable", "read client missing waitForTransactionReceipt");
    }
    try {
      const receipt = await client.waitForTransactionReceipt({
        hash: transactionHash as `0x${string}`,
        status: "ACCEPTED",
      });
      const txExec = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
      if (!txExec) return { status: "accepted", executionResult: null };
      if (txExec === "FINISHED_WITH_RETURN" || txExec === "SUCCESS") return { status: "finalized", executionResult: "ok" };
      if (txExec === "FINISHED_WITH_ERROR") return { status: "finalized_with_error", executionResult: "error" };
      return { status: "finalized", executionResult: txExec };
    } catch (err) {
      const msg = (err as Error)?.message ?? "";
      if (msg.toLowerCase().includes("timeout")) {
        throw new GenLayerError("transaction_timeout", "tx not yet accepted", { cause: err });
      }
      throw new GenLayerError("genlayer_rpc_unavailable", "rpc error", { cause: err });
    }
  }
}

function mapWriteError(err: unknown): GenLayerError {
  const msg = (err as Error)?.message ?? "";
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
    return new GenLayerError("genlayer_rpc_unavailable", msg, { cause: err });
  }
  if (msg.toLowerCase().includes("insufficient funds")) {
    return new GenLayerError("insufficient_funds", msg, { cause: err });
  }
  return new GenLayerError("unknown_genlayer_error", msg, { cause: err });
}

let cached: GenLayerService | null = null;

export function resetServiceCache(): void {
  cached = null;
}

export function getGenLayerService(): GenLayerService {
  if (cached) return cached;
  const network = process.env.GENLAYER_NETWORK ?? "mock";
  if (network === "mock") {
    cached = new MockGenLayerService();
    return cached;
  }
  if (network === "studionet") {
    const addr = process.env.GENLAYER_CONTRACT_ADDRESS;
    if (!addr) {
      throw new GenLayerError("contract_not_configured", "GENLAYER_CONTRACT_ADDRESS unset");
    }
    cached = new GenLayerServiceImpl(addr);
    return cached;
  }
  throw new GenLayerError("contract_not_configured", `Unknown GENLAYER_NETWORK=${network}`);
}
