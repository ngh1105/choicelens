import type { ComparisonResult } from "./comparison";

export type ReceiptStatus =
  | "off_chain_only"
  | "pending"
  | "accepted"
  | "finalized"
  | "failed";

export interface DecisionReceipt {
  id: string;
  payloadHash: string;
  status: ReceiptStatus;
  network: string;
  contractAddress: string | null;
  transactionHash: string | null;
  createdAt: string;
}

export interface GenLayerService {
  isAvailable(): boolean;
  buildReceipt(result: ComparisonResult): DecisionReceipt;
}

const MOCK_NETWORK = "genlayer-studio";
const MOCK_CONTRACT: string | null = null;

function newReceiptId(seed: string): string {
  return `rcpt_${seed.slice(0, 8)}`;
}

class MockGenLayerService implements GenLayerService {
  isAvailable(): boolean {
    return false;
  }

  buildReceipt(result: ComparisonResult): DecisionReceipt {
    return {
      id: newReceiptId(result.receiptPayloadHash),
      payloadHash: result.receiptPayloadHash,
      status: "off_chain_only",
      network: MOCK_NETWORK,
      contractAddress: MOCK_CONTRACT,
      transactionHash: null,
      createdAt: new Date().toISOString(),
    };
  }
}

let cached: GenLayerService | null = null;

export function getGenLayerService(): GenLayerService {
  if (!cached) {
    cached = new MockGenLayerService();
  }
  return cached;
}
