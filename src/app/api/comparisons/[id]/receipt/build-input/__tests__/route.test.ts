import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  getComparison: vi.fn(),
}));

vi.mock("@/lib/genlayer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/genlayer")>("@/lib/genlayer");
  return {
    ...actual,
    buildCreateDecisionReceiptInput: vi.fn(() => ({
      receiptId: "rcpt_cmp1",
      payloadHash: "ph",
      schemaVersion: "v1",
      category: "phones",
      recommendationHash: "rh",
      confidenceBand: "high" as const,
      publicSummaryHash: null,
    })),
  };
});

import { GET } from "../route";
import * as store from "@/lib/store";
import * as gl from "@/lib/genlayer";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () =>
  new Request("http://test/api/comparisons/cmp1/receipt/build-input");

const comparisonRecord = {
  id: "cmp1",
  createdAt: new Date().toISOString(),
  input: {
    prompt: "phones xyz",
    options: [],
    priorities: { price: 50, quality: 50, convenience: 50, risk: 50, durability: 50 },
  },
  result: {
    topPick: { id: "o1", name: "X", finalScore: 0.8, agentScores: [], rank: 1 },
    shortlist: [],
    ranked: [],
    signals: { confidence: 0.7, uncertainty: [], whatWouldChange: [] },
    receiptPayloadHash: "abc12345",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GENLAYER_NETWORK = "studionet";
  process.env.GENLAYER_CONTRACT_ADDRESS = "0xcontract";
});

describe("GET /api/comparisons/[id]/receipt/build-input", () => {
  it("returns deterministic server-derived input", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      comparisonRecord,
    );

    const res = await GET(req(), ctx("cmp1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.input).toEqual({
      receiptId: "rcpt_cmp1",
      payloadHash: "ph",
      schemaVersion: "v1",
      category: "phones",
      recommendationHash: "rh",
      confidenceBand: "high",
      publicSummaryHash: null,
    });
    expect(body.contractAddress).toBe("0xcontract");
    expect(body.network).toBe("studionet");
  });

  it("derives category from comparison server-side, not from request", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      comparisonRecord,
    );
    await GET(req(), ctx("cmp1"));
    const arg = (gl.buildCreateDecisionReceiptInput as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(arg.id).toBe("cmp1");
    expect(arg.result).toBe(comparisonRecord.result);
    // Category derived from prompt — first word.
    expect(arg.category).toBe("phones");
  });

  it("returns 404 when comparison missing", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(req(), ctx("cmp1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });
});
