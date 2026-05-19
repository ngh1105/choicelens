import type { ComparisonResult } from "../comparison";
import { GenLayerError } from "./errors";
import { MockGenLayerService } from "./mock";
import type { CreateDecisionReceiptInput, DecisionReceipt } from "./types";

export interface GenLayerService {
  isAvailable(): boolean;
  buildReceipt(result: ComparisonResult): DecisionReceipt;
  // Real-only methods — mock throws "not_supported" if called.
  createDecisionReceipt?(input: CreateDecisionReceiptInput): Promise<{ transactionHash: string; creatorAddress: string }>;
  refreshReceiptStatus?(transactionHash: string): Promise<{ status: string; executionResult: string | null }>;
}

export class GenLayerServiceImpl implements GenLayerService {
  constructor(private readonly contractAddress: string) {}

  isAvailable(): boolean {
    return true;
  }

  buildReceipt(_result: ComparisonResult): DecisionReceipt {
    throw new GenLayerError("genlayer_rpc_unavailable", "service.buildReceipt is wired in PR #4");
  }
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
