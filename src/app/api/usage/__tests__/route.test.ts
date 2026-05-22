import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usage", () => ({
  getUsageSummary: vi.fn(),
}));

import { GET } from "../route";
import { getUsageSummary } from "@/lib/usage";

const mockedSummary = vi.mocked(getUsageSummary);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/usage", () => {
  it("returns the current usage summary", async () => {
    mockedSummary.mockResolvedValue({
      plan: "free",
      resetAt: "2026-06-01T00:00:00.000Z",
      usage: {
        comparisons: {
          used: 7,
          limit: 20,
          remaining: 13,
          percent: 35,
          blocked: false,
        },
        watchlist: {
          used: 2,
          limit: 10,
          remaining: 8,
          percent: 20,
          blocked: false,
        },
        receipts: {
          used: 1,
          limit: 5,
          remaining: 4,
          percent: 20,
          blocked: false,
        },
      },
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plan: "free",
      resetAt: "2026-06-01T00:00:00.000Z",
      usage: {
        comparisons: {
          used: 7,
          limit: 20,
          remaining: 13,
          percent: 35,
          blocked: false,
        },
        watchlist: {
          used: 2,
          limit: 10,
          remaining: 8,
          percent: 20,
          blocked: false,
        },
        receipts: {
          used: 1,
          limit: 5,
          remaining: 4,
          percent: 20,
          blocked: false,
        },
      },
    });
  });

  it("returns internal_error when usage lookup fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedSummary.mockRejectedValue(new Error("db down"));

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(errorSpy).toHaveBeenCalled();
  });
});
