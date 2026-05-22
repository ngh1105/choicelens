import { describe, expect, it } from "vitest";
import {
  isUsageBlocked,
  localLimitMessage,
  planLimitMessage,
} from "../page";

const baseUsage = {
  plan: "free" as const,
  resetAt: "2026-06-01T00:00:00.000Z",
  usage: {
    comparisons: {
      used: 20,
      limit: 20,
      remaining: 0,
      percent: 100,
      blocked: true,
    },
    watchlist: {
      used: 9,
      limit: 10,
      remaining: 1,
      percent: 90,
      blocked: false,
    },
    receipts: {
      used: 5,
      limit: 5,
      remaining: 0,
      percent: 100,
      blocked: true,
    },
  },
};

describe("page usage helpers", () => {
  it("detects blocked features independently", () => {
    expect(isUsageBlocked(baseUsage, "comparisons")).toBe(true);
    expect(isUsageBlocked(baseUsage, "watchlist")).toBe(false);
    expect(isUsageBlocked(null, "receipts")).toBe(false);
  });

  it("formats local limit messages with upgrade availability copy", () => {
    expect(localLimitMessage("comparisons", baseUsage)).toBe(
      "Free plan includes 20 comparisons. Paid plan upgrades are coming soon.",
    );
    expect(localLimitMessage("receipts", baseUsage)).toBe(
      "Free plan includes 5 receipts. Paid plan upgrades are coming soon.",
    );
  });

  it("formats server plan-limit errors with friendly copy", () => {
    const err = Object.assign(new Error("Free plan includes 10 watchlist items."), {
      status: 402,
      code: "plan_limit_reached",
      feature: "watchlist",
      name: "ApiRequestError",
    });

    expect(planLimitMessage(err as never, "Unable to save top pick.")).toBe(
      "Free plan includes 10 watchlist items. Paid plan upgrades are coming soon.",
    );
  });
});
