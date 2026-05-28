import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    comparison: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    watchlistEntry: {
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    receipt: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import {
  assertWithinPlanLimit,
  getExistingWatchlistEntryForComparison,
  getUsageSummary,
  hasReceiptForComparison,
  PlanLimitError,
} from "../usage";
import { prisma } from "../db";

const user = { id: "user_1", plan: "free" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.comparison.count).mockResolvedValue(0);
  vi.mocked(prisma.watchlistEntry.count).mockResolvedValue(0);
  vi.mocked(prisma.receipt.count).mockResolvedValue(0);
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("usage service", () => {
  it("uses UTC calendar month boundaries", async () => {
    await getUsageSummary(user, new Date("2026-05-22T15:30:00.000Z"));

    expect(prisma.comparison.count).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        createdAt: {
          gte: new Date("2026-05-01T00:00:00.000Z"),
          lt: new Date("2026-06-01T00:00:00.000Z"),
        },
      },
    });
  });

  it("returns derived free usage with clamped remaining", async () => {
    vi.mocked(prisma.comparison.count).mockResolvedValue(21);
    vi.mocked(prisma.watchlistEntry.count).mockResolvedValue(2);
    vi.mocked(prisma.receipt.count).mockResolvedValue(5);

    const summary = await getUsageSummary(user, new Date("2026-05-22T00:00:00.000Z"));

    expect(summary).toEqual({
      plan: "free",
      resetAt: "2026-06-01T00:00:00.000Z",
      usage: {
        comparisons: {
          used: 21,
          limit: 20,
          remaining: 0,
          percent: 100,
          blocked: true,
        },
        watchlist: {
          used: 2,
          limit: 10,
          remaining: 8,
          percent: 20,
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
    });
  });

  it("treats paid internal plans as unlimited", async () => {
    vi.mocked(prisma.comparison.count).mockResolvedValue(200);

    const summary = await getUsageSummary(
      { id: "user_1", plan: "plus" },
      new Date("2026-05-22T00:00:00.000Z"),
    );

    expect(summary.usage.comparisons).toEqual({
      used: 200,
      limit: null,
      remaining: null,
      percent: null,
      blocked: false,
    });
  });

  it("keeps stored-free users on Free even when BILLING_ENABLED=false", async () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    vi.mocked(prisma.comparison.count).mockResolvedValue(200);

    const summary = await getUsageSummary(
      { id: "user_1", plan: "free" },
      new Date("2026-05-22T00:00:00.000Z"),
    );

    expect(summary.plan).toBe("free");
    expect(summary.usage.comparisons.blocked).toBe(true);
  });

  it("throws typed plan limit errors when blocked", async () => {
    vi.mocked(prisma.comparison.count).mockResolvedValue(20);

    await expect(
      assertWithinPlanLimit(
        user,
        "comparisons",
        new Date("2026-05-22T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({
      name: "PlanLimitError",
      feature: "comparisons",
      message: "Free plan includes 20 comparisons.",
      resetAt: "2026-06-01T00:00:00.000Z",
    });

    await expect(
      assertWithinPlanLimit(
        user,
        "comparisons",
        new Date("2026-05-22T00:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("scopes derived usage to the passed visitor user", async () => {
    vi.mocked(prisma.comparison.count)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(9);

    const userA = await getUsageSummary(
      { id: "user_a", plan: "free" },
      new Date("2026-05-22T00:00:00.000Z"),
    );
    const userB = await getUsageSummary(
      { id: "user_b", plan: "free" },
      new Date("2026-05-22T00:00:00.000Z"),
    );

    expect(userA.usage.comparisons.used).toBe(3);
    expect(userB.usage.comparisons.used).toBe(9);
    expect(prisma.comparison.count).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user_a",
        createdAt: {
          gte: new Date("2026-05-01T00:00:00.000Z"),
          lt: new Date("2026-06-01T00:00:00.000Z"),
        },
      },
    });
    expect(prisma.comparison.count).toHaveBeenNthCalledWith(2, {
      where: {
        userId: "user_b",
        createdAt: {
          gte: new Date("2026-05-01T00:00:00.000Z"),
          lt: new Date("2026-06-01T00:00:00.000Z"),
        },
      },
    });
  });

  it("finds existing watchlist entries by comparison payload", async () => {
    vi.mocked(prisma.comparison.findFirst).mockResolvedValue({
      result: JSON.stringify({ receiptPayloadHash: "hash1" }),
    } as never);
    vi.mocked(prisma.watchlistEntry.findUnique).mockResolvedValue({
      id: "watch_1",
    } as never);

    const entry = await getExistingWatchlistEntryForComparison("user_1", "cmp1");

    expect(prisma.comparison.findFirst).toHaveBeenCalledWith({
      where: { id: "cmp1", userId: "user_1" },
      select: { result: true },
    });
    expect(prisma.watchlistEntry.findUnique).toHaveBeenCalledWith({
      where: {
        comparisonId_payloadHash: {
          comparisonId: "cmp1",
          payloadHash: "hash1",
        },
      },
    });
    expect(entry).toEqual({ id: "watch_1" });
  });

  it("returns null for existing watchlist lookup when comparison is missing", async () => {
    vi.mocked(prisma.comparison.findFirst).mockResolvedValue(null);

    await expect(
      getExistingWatchlistEntryForComparison("user_1", "cmp1"),
    ).resolves.toBeNull();
    expect(prisma.watchlistEntry.findUnique).not.toHaveBeenCalled();
  });

  it("checks receipt ownership before idempotent receipt gating", async () => {
    vi.mocked(prisma.receipt.findFirst).mockResolvedValue({ id: "rcpt_1" } as never);

    await expect(hasReceiptForComparison("user_1", "cmp1")).resolves.toBe(true);
    expect(prisma.receipt.findFirst).toHaveBeenCalledWith({
      where: {
        comparisonId: "cmp1",
        comparison: { userId: "user_1" },
      },
      select: { id: true },
    });
  });
});
