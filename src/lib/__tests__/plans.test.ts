import { describe, expect, it } from "vitest";
import {
  formatPlanLimitMessage,
  getPlanDefinition,
  resolvePlanId,
} from "../plans";

describe("plan catalog", () => {
  it("resolves known plans", () => {
    expect(resolvePlanId("free")).toBe("free");
    expect(resolvePlanId("plus")).toBe("plus");
    expect(resolvePlanId("pro")).toBe("pro");
  });

  it("falls back unknown or missing plans to free", () => {
    expect(resolvePlanId("enterprise")).toBe("free");
    expect(resolvePlanId(null)).toBe("free");
    expect(resolvePlanId(undefined)).toBe("free");
  });

  it("defines demo-friendly free limits", () => {
    expect(getPlanDefinition("free").limits).toEqual({
      comparisonsPerMonth: 20,
      watchlistItems: 10,
      receiptsPerMonth: 5,
    });
  });

  it("keeps future paid plans internally unlimited", () => {
    expect(getPlanDefinition("plus").limits).toEqual({
      comparisonsPerMonth: null,
      watchlistItems: null,
      receiptsPerMonth: null,
    });
    expect(getPlanDefinition("pro").limits).toEqual({
      comparisonsPerMonth: null,
      watchlistItems: null,
      receiptsPerMonth: null,
    });
  });

  it("formats user-facing limit messages", () => {
    expect(formatPlanLimitMessage("free", "comparisons", 20)).toBe(
      "Free plan includes 20 comparisons.",
    );
    expect(formatPlanLimitMessage("free", "watchlist", 10)).toBe(
      "Free plan includes 10 watchlist items.",
    );
  });
});
