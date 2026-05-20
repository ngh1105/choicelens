import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetServiceCache, getGenLayerService, GenLayerServiceImpl } from "../service";
import { MockGenLayerService } from "../mock";
import { GenLayerError, isGenLayerError } from "../errors";
import type { CreateDecisionReceiptInput } from "../types";

describe("getGenLayerService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetServiceCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetServiceCache();
  });

  it("returns mock when GENLAYER_NETWORK=mock", () => {
    process.env.GENLAYER_NETWORK = "mock";
    expect(getGenLayerService()).toBeInstanceOf(MockGenLayerService);
  });

  it("returns real impl when GENLAYER_NETWORK=studionet", () => {
    process.env.GENLAYER_NETWORK = "studionet";
    process.env.GENLAYER_CONTRACT_ADDRESS = "0xabc";
    const svc = getGenLayerService();
    expect(svc.constructor.name).toBe("GenLayerServiceImpl");
  });

  it("real impl throws contract_not_configured when address missing", () => {
    process.env.GENLAYER_NETWORK = "studionet";
    delete process.env.GENLAYER_CONTRACT_ADDRESS;
    expect(() => getGenLayerService()).toThrow(GenLayerError);
    let caught: unknown;
    try {
      getGenLayerService();
    } catch (err) {
      caught = err;
    }
    expect(isGenLayerError(caught)).toBe(true);
    expect((caught as GenLayerError).code).toBe("contract_not_configured");
  });
});

const validInput: CreateDecisionReceiptInput = {
  receiptId: "rcpt_1",
  payloadHash: "deadbeef",
  schemaVersion: "v1",
  category: "phones",
  recommendationHash: "abc",
  confidenceBand: "high",
  publicSummaryHash: null,
};

describe("GenLayerServiceImpl.createDecisionReceipt", () => {
  it("submits and returns tx hash + creator", async () => {
    const writeClient = {
      writeContract: vi.fn().mockResolvedValue("0xtx"),
      account: { address: "0xservice" },
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => writeClient as never,
      () => writeClient as never,
    );
    const out = await svc.createDecisionReceipt!(validInput);
    expect(out.transactionHash).toBe("0xtx");
    expect(out.creatorAddress).toBe("0xservice");
    expect(writeClient.writeContract).toHaveBeenCalledOnce();
  });

  it("maps RPC errors to genlayer_rpc_unavailable", async () => {
    const writeClient = {
      writeContract: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1")),
      account: { address: "0xservice" },
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => writeClient as never,
      () => writeClient as never,
    );
    await expect(svc.createDecisionReceipt!(validInput)).rejects.toMatchObject({ code: "genlayer_rpc_unavailable" });
  });

  it("maps insufficient funds errors", async () => {
    const writeClient = {
      writeContract: vi.fn().mockRejectedValue(new Error("insufficient funds for gas")),
      account: { address: "0xservice" },
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => writeClient as never,
      () => writeClient as never,
    );
    await expect(svc.createDecisionReceipt!(validInput)).rejects.toMatchObject({ code: "insufficient_funds" });
  });

  it("propagates service_account_unavailable from write factory", async () => {
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => ({} as never),
      () => { throw new GenLayerError("service_account_unavailable", "no key"); },
    );
    await expect(svc.createDecisionReceipt!(validInput)).rejects.toMatchObject({ code: "service_account_unavailable" });
  });
});

describe("GenLayerServiceImpl.refreshReceiptStatus", () => {
  it("returns finalized when consensus says FINISHED_WITH_RETURN", async () => {
    const readClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }] },
      }),
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => readClient as never,
      () => readClient as never,
    );
    const out = await svc.refreshReceiptStatus!("0xtx");
    expect(out.status).toBe("finalized");
    expect(out.executionResult).toBe("ok");
  });

  it("returns finalized when consensus says SUCCESS", async () => {
    const readClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
      }),
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => readClient as never,
      () => readClient as never,
    );
    const out = await svc.refreshReceiptStatus!("0xtx");
    expect(out.status).toBe("finalized");
    expect(out.executionResult).toBe("ok");
  });

  it("returns finalized_with_error on FINISHED_WITH_ERROR", async () => {
    const readClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_ERROR" }] },
      }),
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => readClient as never,
      () => readClient as never,
    );
    const out = await svc.refreshReceiptStatus!("0xtx");
    expect(out.status).toBe("finalized_with_error");
  });

  it("returns accepted when no execution_result yet", async () => {
    const readClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ consensus_data: {} }),
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => readClient as never,
      () => readClient as never,
    );
    const out = await svc.refreshReceiptStatus!("0xtx");
    expect(out.status).toBe("accepted");
    expect(out.executionResult).toBeNull();
  });

  it("maps timeout errors to transaction_timeout", async () => {
    const readClient = {
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error("polling timeout exceeded")),
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => readClient as never,
      () => readClient as never,
    );
    await expect(svc.refreshReceiptStatus!("0xtx")).rejects.toMatchObject({ code: "transaction_timeout" });
  });

  it("maps other RPC errors to genlayer_rpc_unavailable", async () => {
    const readClient = {
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    const svc = new GenLayerServiceImpl(
      "0xcontract",
      () => readClient as never,
      () => readClient as never,
    );
    await expect(svc.refreshReceiptStatus!("0xtx")).rejects.toMatchObject({ code: "genlayer_rpc_unavailable" });
  });
});

describe("GenLayerServiceImpl.buildReceipt", () => {
  it("returns pending receipt with contract address and null tx", () => {
    const svc = new GenLayerServiceImpl("0xcontract");
    const receipt = svc.buildReceipt({
      topPick: { id: "x", name: "X", finalScore: 0.5, agentScores: [], rank: 1 },
      shortlist: [], ranked: [],
      signals: { confidence: 0.5, uncertainty: [], whatWouldChange: [] },
      receiptPayloadHash: "abcd1234abcd1234",
    });
    expect(receipt.status).toBe("pending");
    expect(receipt.contractAddress).toBe("0xcontract");
    expect(receipt.transactionHash).toBeNull();
    expect(receipt.network).toBe("studionet");
  });
});
