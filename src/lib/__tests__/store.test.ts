import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  comparison: {
    findFirst: vi.fn(),
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
});
