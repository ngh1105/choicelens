import { describe, it, expect } from "vitest";
import { buildCreateDecisionReceiptInput } from "../buildInput";
import type { ComparisonResult } from "@/lib/comparison";

const fixture: ComparisonResult = {
  topPick: { id: "opt-1", name: "X", finalScore: 0.82, agentScores: [], rank: 1 },
  shortlist: [],
  ranked: [],
  signals: { confidence: 0.7, uncertainty: [], whatWouldChange: [] },
  receiptPayloadHash: "abc123def456",
};

describe("buildCreateDecisionReceiptInput", () => {
  it("is deterministic", () => {
    const a = buildCreateDecisionReceiptInput({ id: "cmp-1", category: "phones", result: fixture });
    const b = buildCreateDecisionReceiptInput({ id: "cmp-1", category: "phones", result: fixture });
    expect(a).toEqual(b);
  });
  it("maps confidence to band", () => {
    const lo = buildCreateDecisionReceiptInput({ id: "1", category: "x", result: { ...fixture, signals: { ...fixture.signals, confidence: 0.2 } } });
    expect(lo.confidenceBand).toBe("low");
    const hi = buildCreateDecisionReceiptInput({ id: "1", category: "x", result: { ...fixture, signals: { ...fixture.signals, confidence: 0.9 } } });
    expect(hi.confidenceBand).toBe("high");
  });
});
