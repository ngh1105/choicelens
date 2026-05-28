import type { ComparisonInput, ComparisonResult } from "@/lib/comparison";
import type { DecisionReceipt } from "@/lib/genlayer";

export interface WatchlistEntry {
  id: string;
  comparisonId: string;
  optionId: string;
  name: string;
  score: number;
  addedAt: string;
  payloadHash: string;
}

export interface ComparisonRecord {
  id: string;
  createdAt: string;
  input: ComparisonInput;
  result: ComparisonResult;
}

export interface ReceiptRecord extends DecisionReceipt {
  comparisonId: string;
}

export type UsageFeature = "comparisons" | "watchlist" | "receipts";

export interface UsageMetric {
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
  blocked: boolean;
}

export interface UsageSummary {
  plan: "free" | "plus" | "pro";
  resetAt: string;
  usage: Record<UsageFeature, UsageMetric>;
}
