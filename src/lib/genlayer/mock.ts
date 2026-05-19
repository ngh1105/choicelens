import type { ComparisonResult } from "../comparison";
import type { DecisionReceipt } from "./types";

const MOCK_NETWORK = "genlayer-studio";

function newReceiptId(seed: string): string {
  return `rcpt_${seed.slice(0, 8)}`;
}

export class MockGenLayerService {
  isAvailable(): boolean {
    return false;
  }

  buildReceipt(result: ComparisonResult): DecisionReceipt {
    return {
      id: newReceiptId(result.receiptPayloadHash),
      payloadHash: result.receiptPayloadHash,
      status: "off_chain_only",
      network: MOCK_NETWORK,
      contractAddress: null,
      transactionHash: null,
      createdAt: new Date().toISOString(),
    };
  }
}
