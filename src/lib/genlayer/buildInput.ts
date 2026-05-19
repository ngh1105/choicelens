import type { ComparisonResult } from "../comparison";
import type { CreateDecisionReceiptInput } from "./types";
import { createHash } from "crypto";

const SCHEMA_VERSION = "v1";

function hashHex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function band(c: number): "low" | "medium" | "high" {
  if (c < 0.4) return "low";
  if (c < 0.75) return "medium";
  return "high";
}

export function buildCreateDecisionReceiptInput(args: {
  id: string;
  category: string;
  result: ComparisonResult;
}): CreateDecisionReceiptInput {
  return {
    receiptId: `rcpt_${args.id}`,
    payloadHash: args.result.receiptPayloadHash,
    schemaVersion: SCHEMA_VERSION,
    category: args.category,
    recommendationHash: hashHex(`${args.result.topPick.id}:${args.result.topPick.finalScore}`),
    confidenceBand: band(args.result.signals.confidence),
    publicSummaryHash: null,
  };
}
