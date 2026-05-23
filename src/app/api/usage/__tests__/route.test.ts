import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usage", () => ({
  getUsageSummary: vi.fn(),
}));

vi.mock("@/lib/visitor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visitor")>(
    "@/lib/visitor",
  );
  return {
    ...actual,
    getOrCreateVisitorUser: vi.fn(),
  };
});

import { GET } from "../route";
import { getUsageSummary } from "@/lib/usage";
import { getOrCreateVisitorUser } from "@/lib/visitor";

const mockedSummary = vi.mocked(getUsageSummary);
const mockedVisitor = vi.mocked(getOrCreateVisitorUser);
const visitor = {
  id: "user_visitor",
  plan: "free",
  visitorId: "v_testvisitor00000000000000000000000000000000",
  shouldSetCookie: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedVisitor.mockResolvedValue(visitor);
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

    const res = await GET(new Request("http://test/api/usage"));

    expect(res.status).toBe(200);
    expect(mockedSummary).toHaveBeenCalledWith(visitor);
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

    const res = await GET(new Request("http://test/api/usage"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns internal_error when visitor lookup fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedVisitor.mockRejectedValue(new Error("db down"));

    const res = await GET(new Request("http://test/api/usage"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(mockedSummary).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
