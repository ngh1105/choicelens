import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetServiceCache, getGenLayerService } from "../service";
import { MockGenLayerService } from "../mock";
import { GenLayerError, isGenLayerError } from "../errors";

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
