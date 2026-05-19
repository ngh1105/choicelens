import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  getComparison: vi.fn(),
  getReceiptForComparison: vi.fn(),
  saveReceipt: vi.fn(),
  updateReceiptStatus: vi.fn(),
  StoreError: class StoreError extends Error {
    code: string;
    constructor(code: string, msg: string) {
      super(msg);
      this.code = code;
      this.name = "StoreError";
    }
  },
}));

vi.mock("@/lib/genlayer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/genlayer")>("@/lib/genlayer");
  return {
    ...actual,
    getGenLayerService: vi.fn(),
    buildCreateDecisionReceiptInput: vi.fn(() => ({
      receiptId: "rcpt_cmp1",
      payloadHash: "ph",
      schemaVersion: "v1",
      category: "general",
      recommendationHash: "rh",
      confidenceBand: "high" as const,
      publicSummaryHash: null,
    })),
  };
});

import { GET, POST } from "../route";
import * as store from "@/lib/store";
import * as gl from "@/lib/genlayer";
import { GenLayerError } from "@/lib/genlayer";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://test/api/comparisons/cmp1/receipt");

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

const baseReceipt = {
  id: "rcpt_abc12345",
  comparisonId: "cmp1",
  payloadHash: "abc12345",
  status: "off_chain_only" as const,
  network: "studionet",
  submitterKind: "mock" as const,
  creatorAddress: null,
  contractAddress: null,
  transactionHash: null,
  executionResult: null,
  errorCode: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GENLAYER_NETWORK = "mock";
  delete process.env.GENLAYER_CONTRACT_ADDRESS;
});

describe("POST /api/comparisons/[id]/receipt", () => {
  it("uses mock path when GENLAYER_NETWORK=mock", async () => {
    process.env.GENLAYER_NETWORK = "mock";
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(comparisonRecord);
    const fakeSvc = {
      isAvailable: () => false,
      buildReceipt: vi.fn().mockReturnValue({
        id: "rcpt_abc12345",
        payloadHash: "abc12345",
        status: "off_chain_only",
        network: "studionet",
        contractAddress: null,
        transactionHash: null,
        createdAt: new Date().toISOString(),
      }),
      createDecisionReceipt: vi.fn(),
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(fakeSvc);
    (store.saveReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseReceipt,
      submitterKind: "mock",
      status: "off_chain_only",
    });

    const res = await POST(req(), ctx("cmp1"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.receipt.submitterKind).toBe("mock");
    expect(body.receipt.status).toBe("off_chain_only");
    expect(fakeSvc.createDecisionReceipt).not.toHaveBeenCalled();
    expect((store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls[0][0].submitterKind).toBe("mock");
  });

  it("uses service path when GENLAYER_NETWORK=studionet", async () => {
    process.env.GENLAYER_NETWORK = "studionet";
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(comparisonRecord);
    const fakeSvc = {
      isAvailable: () => true,
      buildReceipt: vi.fn().mockReturnValue({
        id: "rcpt_abc12345",
        payloadHash: "abc12345",
        status: "pending",
        network: "studionet",
        contractAddress: "0xcontract",
        transactionHash: null,
        createdAt: new Date().toISOString(),
      }),
      createDecisionReceipt: vi.fn().mockResolvedValue({
        transactionHash: "0xabc",
        creatorAddress: "0xservice",
      }),
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(fakeSvc);
    (store.saveReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseReceipt,
      submitterKind: "service",
      status: "pending",
      transactionHash: "0xabc",
      creatorAddress: "0xservice",
      contractAddress: "0xcontract",
    });

    const res = await POST(req(), ctx("cmp1"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.receipt.submitterKind).toBe("service");
    expect(body.receipt.transactionHash).toBe("0xabc");
    expect(body.receipt.status).toBe("pending");
    expect(fakeSvc.createDecisionReceipt).toHaveBeenCalledOnce();
    const saveArgs = (store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saveArgs.submitterKind).toBe("service");
    expect(saveArgs.creatorAddress).toBe("0xservice");
    expect(saveArgs.receipt.transactionHash).toBe("0xabc");
    expect(saveArgs.receipt.status).toBe("pending");
  });

  it("maps GenLayerError to HTTP code on service path", async () => {
    process.env.GENLAYER_NETWORK = "studionet";
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(comparisonRecord);
    const fakeSvc = {
      isAvailable: () => true,
      buildReceipt: vi.fn(),
      createDecisionReceipt: vi
        .fn()
        .mockRejectedValue(new GenLayerError("service_account_unavailable", "no key")),
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(fakeSvc);

    const res = await POST(req(), ctx("cmp1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("service_account_unavailable");
  });

  it("returns 404 when comparison missing", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(req(), ctx("cmp1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });
});

describe("GET /api/comparisons/[id]/receipt", () => {
  it("returns 404 when no receipt row", async () => {
    (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(req(), ctx("cmp1"));
    expect(res.status).toBe(404);
  });

  it("returns terminal-status row unchanged without polling", async () => {
    const finalized = {
      ...baseReceipt,
      status: "finalized" as const,
      submitterKind: "service" as const,
      transactionHash: "0xabc",
    };
    (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(finalized);
    const fakeSvc = {
      isAvailable: () => true,
      buildReceipt: vi.fn(),
      refreshReceiptStatus: vi.fn(),
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(fakeSvc);

    const res = await GET(req(), ctx("cmp1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.status).toBe("finalized");
    expect(fakeSvc.refreshReceiptStatus).not.toHaveBeenCalled();
  });

  it("polls and updates pending row when refresh returns new status", async () => {
    const pending = {
      ...baseReceipt,
      status: "pending" as const,
      submitterKind: "service" as const,
      transactionHash: "0xabc",
    };
    const updated = { ...pending, status: "accepted" as const };
    (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    (store.updateReceiptStatus as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
    const fakeSvc = {
      isAvailable: () => true,
      buildReceipt: vi.fn(),
      refreshReceiptStatus: vi
        .fn()
        .mockResolvedValue({ status: "accepted", executionResult: null }),
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(fakeSvc);

    const res = await GET(req(), ctx("cmp1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.status).toBe("accepted");
    expect(fakeSvc.refreshReceiptStatus).toHaveBeenCalledWith("0xabc");
    expect((store.updateReceiptStatus as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      comparisonId: "cmp1",
      status: "accepted",
      executionResult: null,
    });
  });

  it("returns existing row when refresh throws transaction_timeout", async () => {
    const pending = {
      ...baseReceipt,
      status: "pending" as const,
      submitterKind: "service" as const,
      transactionHash: "0xabc",
    };
    (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    const fakeSvc = {
      isAvailable: () => true,
      buildReceipt: vi.fn(),
      refreshReceiptStatus: vi
        .fn()
        .mockRejectedValue(new GenLayerError("transaction_timeout", "still pending")),
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(fakeSvc);

    const res = await GET(req(), ctx("cmp1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.status).toBe("pending");
    expect(store.updateReceiptStatus).not.toHaveBeenCalled();
  });
});
