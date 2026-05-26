import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  getComparison: vi.fn(),
  getReceiptForComparison: vi.fn(),
  saveReceipt: vi.fn(),
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

import { POST } from "../route";
import * as store from "@/lib/store";
import * as gl from "@/lib/genlayer";
import * as usage from "@/lib/usage";
import { getOrCreateVisitorUser } from "@/lib/visitor";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const visitor = {
  id: "user_visitor",
  plan: "free",
  visitorId: "v_testvisitor00000000000000000000000000000000",
  shouldSetCookie: false,
};

function postReq(body: unknown): Request {
  return new Request("http://test/api/comparisons/cmp1/receipt/wallet-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

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
  status: "pending" as const,
  network: "studionet",
  submitterKind: "user" as const,
  creatorAddress: "0x1234567890abcdef1234567890abcdef12345678",
  contractAddress: "0xcontract",
  transactionHash: "0xabc",
  executionResult: null,
  errorCode: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const VALID_ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const VALID_TX = "0xdeadbeef";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrCreateVisitorUser).mockResolvedValue(visitor);
  process.env.GENLAYER_NETWORK = "studionet";
  process.env.GENLAYER_CONTRACT_ADDRESS = "0xcontract";
  (usage.assertWithinPlanLimit as ReturnType<typeof vi.fn>).mockResolvedValue(
    undefined,
  );
  (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("POST /api/comparisons/[id]/receipt/wallet-tx", () => {
  it("rejects when transactionHash is missing", async () => {
    const res = await POST(
      postReq({ creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("wallet_not_connected");
  });

  it("rejects when creatorAddress is missing", async () => {
    const res = await POST(
      postReq({ transactionHash: VALID_TX }),
      ctx("cmp1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("wallet_not_connected");
  });

  it("rejects when creatorAddress is not a 20-byte hex address", async () => {
    const res = await POST(
      postReq({ transactionHash: VALID_TX, creatorAddress: "0xnope" }),
      ctx("cmp1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("wallet_rejected");
  });

  it("rejects when transactionHash is not hex", async () => {
    const res = await POST(
      postReq({ transactionHash: "not-hex", creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("wallet_rejected");
  });

  it("returns 404 when comparison missing", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(
      postReq({ transactionHash: VALID_TX, creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("upserts row with submitterKind=user and ignores any client-supplied receipt fields", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      comparisonRecord,
    );
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
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(
      fakeSvc,
    );
    (store.saveReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseReceipt,
      transactionHash: VALID_TX,
      creatorAddress: VALID_ADDR,
    });

    // Client tries to inject a malicious payloadHash; it must be ignored.
    const res = await POST(
      postReq({
        transactionHash: VALID_TX,
        creatorAddress: VALID_ADDR,
        payloadHash: "deadbeefdeadbeef",
        status: "finalized",
      }),
      ctx("cmp1"),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.receipt.submitterKind).toBe("user");
    expect(body.receipt.transactionHash).toBe(VALID_TX);
    expect(body.receipt.creatorAddress).toBe(VALID_ADDR);

    expect(store.getComparison).toHaveBeenCalledWith("user_visitor", "cmp1");
    expect(store.getReceiptForComparison).toHaveBeenCalledWith(
      "user_visitor",
      "cmp1",
    );
    expect(usage.assertWithinPlanLimit).toHaveBeenCalledWith(
      expect.objectContaining(visitor),
      "receipts",
    );
    const saveArgs = (store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(saveArgs.submitterKind).toBe("user");
    expect(saveArgs.creatorAddress).toBe(VALID_ADDR);
    // payloadHash comes from server-built receipt, NOT from request body.
    expect(saveArgs.receipt.payloadHash).toBe("abc12345");
    expect(saveArgs.receipt.transactionHash).toBe(VALID_TX);
    expect(saveArgs.receipt.status).toBe("pending");
  });

  it("validates request shape before checking receipt limit", async () => {
    const res = await POST(
      postReq({ creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );

    expect(res.status).toBe(400);
    expect(usage.assertWithinPlanLimit).not.toHaveBeenCalled();
  });

  it("returns existing receipt at the receipt limit without creating a new one", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      comparisonRecord,
    );
    (store.getReceiptForComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseReceipt,
    );

    const res = await POST(
      postReq({ transactionHash: VALID_TX, creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: baseReceipt });
    expect(usage.assertWithinPlanLimit).not.toHaveBeenCalled();
    expect(gl.getGenLayerService).not.toHaveBeenCalled();
    expect(store.saveReceipt).not.toHaveBeenCalled();
  });

  it("returns 402 when receipt limit blocks a new wallet receipt", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      comparisonRecord,
    );
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

    const res = await POST(
      postReq({ transactionHash: VALID_TX, creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: "plan_limit_reached",
      feature: "receipts",
    });
    expect(gl.getGenLayerService).not.toHaveBeenCalled();
    expect(store.saveReceipt).not.toHaveBeenCalled();
  });

  it("idempotent replay: second POST with new tx hash upserts (unique key wins)", async () => {
    (store.getComparison as ReturnType<typeof vi.fn>).mockResolvedValue(
      comparisonRecord,
    );
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
    };
    (gl.getGenLayerService as ReturnType<typeof vi.fn>).mockReturnValue(
      fakeSvc,
    );
    (store.saveReceipt as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId: string, args: { receipt: { transactionHash: string } }) => ({
        ...baseReceipt,
        transactionHash: args.receipt.transactionHash,
        creatorAddress: VALID_ADDR,
      }),
    );

    const tx1 = "0xaaa";
    const tx2 = "0xbbb";
    const res1 = await POST(
      postReq({ transactionHash: tx1, creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );
    const res2 = await POST(
      postReq({ transactionHash: tx2, creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    expect(body2.receipt.transactionHash).toBe(tx2);
    expect((store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
