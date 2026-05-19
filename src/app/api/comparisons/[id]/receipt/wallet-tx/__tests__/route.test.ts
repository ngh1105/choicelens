import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  getComparison: vi.fn(),
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

import { POST } from "../route";
import * as store from "@/lib/store";
import * as gl from "@/lib/genlayer";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

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
  process.env.GENLAYER_NETWORK = "studionet";
  process.env.GENLAYER_CONTRACT_ADDRESS = "0xcontract";
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
    expect(body.error).toBe("wallet_not_connected");
  });

  it("rejects when transactionHash is not hex", async () => {
    const res = await POST(
      postReq({ transactionHash: "not-hex", creatorAddress: VALID_ADDR }),
      ctx("cmp1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("wallet_not_connected");
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

    const saveArgs = (store.saveReceipt as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saveArgs.submitterKind).toBe("user");
    expect(saveArgs.creatorAddress).toBe(VALID_ADDR);
    // payloadHash comes from server-built receipt, NOT from request body.
    expect(saveArgs.receipt.payloadHash).toBe("abc12345");
    expect(saveArgs.receipt.transactionHash).toBe(VALID_TX);
    expect(saveArgs.receipt.status).toBe("pending");
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
      async (args: { receipt: { transactionHash: string } }) => ({
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
