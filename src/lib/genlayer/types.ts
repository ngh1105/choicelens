export type SubmitterKind = "service" | "user" | "mock";
export type ReceiptStatus =
  | "off_chain_only"
  | "pending"
  | "accepted"
  | "finalized"
  | "finalized_with_error"
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

export interface CreateDecisionReceiptInput {
  receiptId: string;
  payloadHash: string;
  schemaVersion: string;
  category: string;
  recommendationHash: string;
  confidenceBand: "low" | "medium" | "high";
  publicSummaryHash: string | null;
}
