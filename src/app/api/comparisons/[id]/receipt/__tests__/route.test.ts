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

vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>(
    "@/lib/usage",
  );
  return {
    ...actual,
    assertWithinPlanLimit: vi.fn(),
  };
});

vi.mock("@/lib/visitor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visitor")>(
    "@/lib/visitor",
  );
  return {
    ...actual,
    getOrCreateVisitorUser: vi.fn(),
  };
});

import { GET, POST } from "../route";
import * as store from "@/lib/store";
import * as gl from "@/lib/genlayer";
import { GenLayerError } from "@/lib/genlayer";
import * as usage from "@/lib/usage";
import { getOrCreateVisitorUser } from "@/lib/visitor";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://test/api/comparisons/cmp1/receipt");
const visitor = {
  id: "user_visitor",
  plan: "free",
  visitorId: "v_testvisitor00000000000000000000000000000000",
  shouldSetCookie: false,
};

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
  vi.mocked(getOrCreateVisitorUser).mockResolvedValue(visitor);
  process.env.GENLAYER_NETWORK = "mock";
  delete process.env.GENLAYER_CONTRACT_ADDRESS;
  (usage.assertWithinPlanLimit as ReturnType<typeof vi.fn>).mockResolvedValue(
    undefined,
  );
  (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(null);
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
    expect(store.getComparison).toHaveBeenCalledWith("user_visitor", "cmp1");
    expect(usage.assertWithinPlanLimit).toHaveBeenCalledWith(
      visitor,
      "receipts",
    );
    expect((store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "user_visitor",
    );
    expect((store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls[0][1].submitterKind).toBe("mock");
  });

  it("returns existing receipt at the receipt limit without creating a new one", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(comparisonRecord);
    (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseReceipt,
    );

    const res = await POST(req(), ctx("cmp1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: baseReceipt });
    expect(usage.assertWithinPlanLimit).not.toHaveBeenCalled();
    expect(gl.getGenLayerService).not.toHaveBeenCalled();
    expect(store.saveReceipt).not.toHaveBeenCalled();
  });

  it("returns 402 when receipt limit blocks a new receipt", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(comparisonRecord);
    (usage.assertWithinPlanLimit as ReturnType<typeof vi.fn>).mockRejectedValue(
      new usage.PlanLimitError({
        feature: "receipts",
        message: "Free plan includes 5 receipts.",
        usage: {
          used: 5,
          limit: 5,
          remaining: 0,
          percent: 100,
          blocked: true,
        },
        resetAt: "2026-06-01T00:00:00.000Z",
      }),
    );

    const res = await POST(req(), ctx("cmp1"));

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "plan_limit_reached",
      feature: "receipts",
      message: "Free plan includes 5 receipts.",
      usage: {
        used: 5,
        limit: 5,
        remaining: 0,
        percent: 100,
        blocked: true,
      },
      resetAt: "2026-06-01T00:00:00.000Z",
    });
    expect(gl.getGenLayerService).not.toHaveBeenCalled();
    expect(store.saveReceipt).not.toHaveBeenCalled();
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
    const saveArgs = (store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls[0][1];
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
    expect((store.updateReceiptStatus as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "user_visitor",
    );
    expect((store.updateReceiptStatus as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({
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
