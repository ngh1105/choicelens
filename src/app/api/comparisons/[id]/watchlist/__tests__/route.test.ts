import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  addWatchlistEntry: vi.fn(),
  StoreError: class StoreError extends Error {
    code: string;
    constructor(code: string, msg: string) {
      super(msg);
      this.code = code;
      this.name = "StoreError";
    }
  },
}));

vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>(
    "@/lib/usage",
  );
  return {
    ...actual,
    assertWithinPlanLimit: vi.fn(),
    getExistingWatchlistEntryForComparison: vi.fn(),
  };
});

import { POST } from "../route";
import * as store from "@/lib/store";
import * as usage from "@/lib/usage";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://test/api/comparisons/cmp1/watchlist");

const entry = {
  id: "watch1",
  comparisonId: "cmp1",
  optionId: "o1",
  name: "A",
  score: 80,
  payloadHash: "hash1",
  addedAt: "2026-05-22T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usage.assertWithinPlanLimit).mockResolvedValue(undefined);
  vi.mocked(usage.getExistingWatchlistEntryForComparison).mockResolvedValue(null);
});

describe("POST /api/comparisons/[id]/watchlist", () => {
  it("saves a watchlist entry when under the free limit", async () => {
    vi.mocked(store.addWatchlistEntry).mockResolvedValue(entry);

    const res = await POST(req(), ctx("cmp1"));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ entry });
    expect(usage.assertWithinPlanLimit).toHaveBeenCalledWith("watchlist");
  });

  it("returns 402 when watchlist limit blocks a new save", async () => {
    vi.mocked(usage.assertWithinPlanLimit).mockRejectedValue(
      new usage.PlanLimitError({
        feature: "watchlist",
        message: "Free plan includes 10 watchlist items.",
        usage: {
          used: 10,
          limit: 10,
          remaining: 0,
          percent: 100,
          blocked: true,
        },
        resetAt: "2026-06-01T00:00:00.000Z",
      }),
    );

    const res = await POST(req(), ctx("cmp1"));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: "plan_limit_reached",
      feature: "watchlist",
    });
    expect(store.addWatchlistEntry).not.toHaveBeenCalled();
  });

  it("allows duplicate watchlist saves at the limit", async () => {
    vi.mocked(usage.getExistingWatchlistEntryForComparison).mockResolvedValue(
      { id: "watch1" } as never,
    );
    vi.mocked(store.addWatchlistEntry).mockResolvedValue(entry);

    const res = await POST(req(), ctx("cmp1"));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ entry });
    expect(usage.assertWithinPlanLimit).not.toHaveBeenCalled();
  });

  it("returns 404 when comparison is missing", async () => {
    const StoreError = store.StoreError;
    vi.mocked(store.addWatchlistEntry).mockRejectedValue(
      new StoreError("comparison_not_found", "Comparison not found"),
    );

    const res = await POST(req(), ctx("missing"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
