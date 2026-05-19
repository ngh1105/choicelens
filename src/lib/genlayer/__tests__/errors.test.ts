import { describe, it, expect } from "vitest";
import { GenLayerError, isGenLayerError } from "../errors";

describe("GenLayerError", () => {
  it("captures code + message", () => {
    const err = new GenLayerError("transaction_timeout", "timed out");
    expect(err.code).toBe("transaction_timeout");
    expect(err.message).toBe("timed out");
  });
  it("isGenLayerError narrows", () => {
    const err = new GenLayerError("wallet_rejected", "x");
    expect(isGenLayerError(err)).toBe(true);
    expect(isGenLayerError(new Error("nope"))).toBe(false);
  });
});
