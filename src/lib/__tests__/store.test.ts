import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  comparison: {
    findFirst: vi.fn(),
  },
  comparisonFeedback: {
    create: vi.fn(),
  },
  watchlistEntry: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  user: {
    findUniqueOrThrow: vi.fn(),
  },
};

vi.mock("../db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    comparison: {
      findFirst: vi.fn(),
    },
    receipt: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../usage", () => ({
  assertWithinPlanLimitForUser: vi.fn(),
}));

import {
  addWatchlistEntry,
  getComparison,
  getReceiptForComparison,
  saveComparisonFeedback,
  StoreError,
  updateReceiptStatus,
} from "../store";
import { prisma } from "../db";

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (client: typeof tx) => unknown) => fn(tx),
  );
  vi.mocked(prisma.comparison.findFirst).mockResolvedValue(null);
  tx.comparison.findFirst.mockResolvedValue(null);
});

describe("store visitor ownership", () => {
  it("returns null when comparison belongs to another visitor", async () => {
    await expect(getComparison("user_a", "cmp1")).resolves.toBeNull();

    expect(prisma.comparison.findFirst).toHaveBeenCalledWith({
      where: { id: "cmp1", userId: "user_a" },
    });
  });

  it("blocks watchlist creation for another visitor comparison", async () => {
    await expect(
      addWatchlistEntry("user_a", { comparisonId: "cmp1" }),
    ).rejects.toMatchObject({
      name: "StoreError",
      code: "comparison_not_found",
    });

    expect(tx.comparison.findFirst).toHaveBeenCalledWith({
      where: { id: "cmp1", userId: "user_a" },
    });
  });

  it("returns null for receipt lookup when comparison is not owned", async () => {
    await expect(getReceiptForComparison("user_a", "cmp1")).resolves.toBeNull();
    expect(prisma.receipt.findUnique).not.toHaveBeenCalled();
  });

  it("blocks receipt status updates for another visitor comparison", async () => {
    await expect(
      updateReceiptStatus("user_a", {
        comparisonId: "cmp1",
        status: "accepted",
        executionResult: null,
      }),
    ).rejects.toBeInstanceOf(StoreError);
    expect(prisma.receipt.update).not.toHaveBeenCalled();
  });

  it("stores comparison feedback for an owned comparison", async () => {
    tx.comparison.findFirst.mockResolvedValue({ id: "cmp1" });
    tx.comparisonFeedback.create.mockResolvedValue({
      id: "fb1",
      comparisonId: "cmp1",
      helpful: false,
      createdAt: new Date("2026-05-28T00:00:00.000Z"),
    });

    await expect(
      saveComparisonFeedback("user_a", { comparisonId: "cmp1", helpful: false }),
    ).resolves.toEqual({
      id: "fb1",
      comparisonId: "cmp1",
      helpful: false,
      createdAt: "2026-05-28T00:00:00.000Z",
    });
    expect(tx.comparisonFeedback.create).toHaveBeenCalledWith({
      data: {
        comparisonId: "cmp1",
        userId: "user_a",
        helpful: false,
      },
    });
  });

  it("blocks comparison feedback for another visitor comparison", async () => {
    await expect(
      saveComparisonFeedback("user_a", { comparisonId: "cmp1", helpful: true }),
    ).rejects.toMatchObject({
      name: "StoreError",
      code: "comparison_not_found",
    });
    expect(tx.comparisonFeedback.create).not.toHaveBeenCalled();
  });
});
