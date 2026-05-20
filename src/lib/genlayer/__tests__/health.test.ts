import { describe, it, expect } from "vitest";
import {
  computeOperatorState,
  type ReceiptSnapshot,
  type HealthEnv,
} from "../health";

const VALID_KEY = "0x" + "a".repeat(64);

const NOW = new Date("2026-05-20T15:00:00.000Z");

function rec(
  overrides: Partial<ReceiptSnapshot> & { ageMinutes?: number },
): ReceiptSnapshot {
  const ageMs = (overrides.ageMinutes ?? 60) * 60 * 1000;
  const ts = new Date(NOW.getTime() - ageMs);
  return {
    comparisonId: overrides.comparisonId ?? "cmp_x",
    status: overrides.status ?? "finalized",
    network: overrides.network ?? "studionet",
    errorCode: overrides.errorCode ?? null,
    createdAt: ts,
    updatedAt: overrides.updatedAt ?? ts,
  };
}

const STUDIONET_ENV: HealthEnv = {
  network: "studionet",
  contractAddress: "0xD7E2910DBbCb701992591b4285985a3Ad0e0A418",
  serviceKey: VALID_KEY,
  rpcUrl: "https://studio.genlayer.com/api",
};

describe("computeOperatorState", () => {
  it("mock when network unset and no studionet history", () => {
    const out = computeOperatorState({
      env: { network: undefined, contractAddress: undefined, serviceKey: undefined, rpcUrl: undefined },
      recentReceipts: [],
      hasPriorStudionetReceipt: false,
      serviceAddress: null,
      now: NOW,
    });
    expect(out.operatorState).toBe("mock");
    expect(out.killSwitchActive).toBe(false);
  });

  it("kill_switch_active when network=mock but prior studionet receipts exist", () => {
    const out = computeOperatorState({
      env: { ...STUDIONET_ENV, network: "mock" },
      recentReceipts: [],
      hasPriorStudionetReceipt: true,
      serviceAddress: null,
      now: NOW,
    });
    expect(out.operatorState).toBe("kill_switch_active");
    expect(out.killSwitchActive).toBe(true);
  });

  it("contract_not_configured when studionet but no contract", () => {
    const out = computeOperatorState({
      env: { ...STUDIONET_ENV, contractAddress: "" },
      recentReceipts: [],
      hasPriorStudionetReceipt: false,
      serviceAddress: null,
      now: NOW,
    });
    expect(out.operatorState).toBe("contract_not_configured");
  });

  it("studionet_no_service_key when key missing", () => {
    const out = computeOperatorState({
      env: { ...STUDIONET_ENV, serviceKey: undefined },
      recentReceipts: [],
      hasPriorStudionetReceipt: false,
      serviceAddress: null,
      now: NOW,
    });
    expect(out.operatorState).toBe("studionet_no_service_key");
    expect(out.serviceKeyPresent).toBe(false);
  });

  it("studionet_no_service_key when key format invalid", () => {
    const out = computeOperatorState({
      env: { ...STUDIONET_ENV, serviceKey: "not-a-real-key" },
      recentReceipts: [],
      hasPriorStudionetReceipt: false,
      serviceAddress: null,
      now: NOW,
    });
    expect(out.operatorState).toBe("studionet_no_service_key");
    expect(out.serviceKeyPresent).toBe(true);
    expect(out.serviceKeyFormatValid).toBe(false);
  });

  it("insufficient_funds wins over rpc errors", () => {
    const out = computeOperatorState({
      env: STUDIONET_ENV,
      recentReceipts: [
        rec({ status: "failed", errorCode: "genlayer_rpc_unavailable", ageMinutes: 30 }),
        rec({ status: "failed", errorCode: "insufficient_funds", ageMinutes: 60 }),
      ],
      hasPriorStudionetReceipt: true,
      serviceAddress: "0xservice",
      now: NOW,
    });
    expect(out.operatorState).toBe("insufficient_funds");
  });

  it("studionet_unavailable on rpc errors in last 24h", () => {
    const out = computeOperatorState({
      env: STUDIONET_ENV,
      recentReceipts: [
        rec({ status: "failed", errorCode: "transaction_timeout", ageMinutes: 120 }),
      ],
      hasPriorStudionetReceipt: true,
      serviceAddress: "0xservice",
      now: NOW,
    });
    expect(out.operatorState).toBe("studionet_unavailable");
  });

  it("studionet_configured when at least one finalized in last 24h", () => {
    const out = computeOperatorState({
      env: STUDIONET_ENV,
      recentReceipts: [rec({ status: "finalized", ageMinutes: 60 })],
      hasPriorStudionetReceipt: true,
      serviceAddress: "0xservice",
      now: NOW,
    });
    expect(out.operatorState).toBe("studionet_configured");
    expect(out.counts24h.finalized).toBe(1);
    expect(out.lastSuccessfulAt).not.toBeNull();
  });

  it("studionet_idle when configured but no traffic", () => {
    const out = computeOperatorState({
      env: STUDIONET_ENV,
      recentReceipts: [],
      hasPriorStudionetReceipt: false,
      serviceAddress: "0xservice",
      now: NOW,
    });
    expect(out.operatorState).toBe("studionet_idle");
  });

  it("excludes receipts older than 24h from counts", () => {
    const out = computeOperatorState({
      env: STUDIONET_ENV,
      recentReceipts: [
        rec({ status: "finalized", ageMinutes: 60 }),
        rec({ status: "finalized", ageMinutes: 25 * 60 }),
      ],
      hasPriorStudionetReceipt: true,
      serviceAddress: "0xservice",
      now: NOW,
    });
    expect(out.counts24h.finalized).toBe(1);
  });

  it("redacts the contract address but keeps the full value too", () => {
    const out = computeOperatorState({
      env: STUDIONET_ENV,
      recentReceipts: [],
      hasPriorStudionetReceipt: false,
      serviceAddress: null,
      now: NOW,
    });
    expect(out.contractAddress).toBe("0xD7E2910DBbCb701992591b4285985a3Ad0e0A418");
    expect(out.contractAddressRedacted).toBe("0xD7E2…A418");
  });

  it("never includes the service key in the snapshot", () => {
    const out = computeOperatorState({
      env: STUDIONET_ENV,
      recentReceipts: [],
      hasPriorStudionetReceipt: false,
      serviceAddress: "0xservice",
      now: NOW,
    });
    expect(JSON.stringify(out)).not.toContain(VALID_KEY);
  });
});
