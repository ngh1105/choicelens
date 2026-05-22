import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  listComparisons: vi.fn(),
  saveComparison: vi.fn(),
}));

vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>(
    "@/lib/usage",
  );
  return {
    ...actual,
    assertWithinPlanLimit: vi.fn(),
  };
});

import { GET, POST } from "../route";
import { DEFAULT_PRIORITIES } from "@/lib/comparison";
import * as store from "@/lib/store";
import * as usage from "@/lib/usage";

function postReq(body: unknown): Request {
  return new Request("http://test/api/comparisons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const input = {
  prompt: "Compare laptops",
  options: [
    { id: "o1", name: "A" },
    { id: "o2", name: "B" },
  ],
  priorities: DEFAULT_PRIORITIES,
  mustHaves: "",
  dealBreakers: "",
};

const comparisonRecord = {
  id: "cmp1",
  createdAt: "2026-05-22T00:00:00.000Z",
  input,
  result: {
    topPick: { id: "o1", name: "A", finalScore: 80, agentScores: [], rank: 1 },
    shortlist: [],
    ranked: [],
    signals: { confidence: 80, uncertainty: [], whatWouldChange: [] },
    receiptPayloadHash: "hash1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usage.assertWithinPlanLimit).mockResolvedValue(undefined);
});

describe("GET /api/comparisons", () => {
  it("returns saved comparisons", async () => {
    vi.mocked(store.listComparisons).mockResolvedValue([comparisonRecord]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comparisons: [comparisonRecord] });
  });
});

describe("POST /api/comparisons", () => {
  it("validates input before checking plan limits", async () => {
    const res = await POST(postReq({ options: [] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_input" });
    expect(usage.assertWithinPlanLimit).not.toHaveBeenCalled();
  });

  it("creates a comparison when under the free limit", async () => {
    vi.mocked(store.saveComparison).mockResolvedValue(comparisonRecord);

    const res = await POST(postReq(input));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ comparison: comparisonRecord });
    expect(usage.assertWithinPlanLimit).toHaveBeenCalledWith("comparisons");
    expect(store.saveComparison).toHaveBeenCalled();
  });

  it("returns 402 when comparison limit is reached", async () => {
    vi.mocked(usage.assertWithinPlanLimit).mockRejectedValue(
      new usage.PlanLimitError({
        feature: "comparisons",
        message: "Free plan includes 20 comparisons.",
        usage: {
          used: 20,
          limit: 20,
          remaining: 0,
          percent: 100,
          blocked: true,
        },
        resetAt: "2026-06-01T00:00:00.000Z",
      }),
    );

    const res = await POST(postReq(input));

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "plan_limit_reached",
      feature: "comparisons",
      message: "Free plan includes 20 comparisons.",
      usage: {
        used: 20,
        limit: 20,
        remaining: 0,
        percent: 100,
        blocked: true,
      },
      resetAt: "2026-06-01T00:00:00.000Z",
    });
    expect(store.saveComparison).not.toHaveBeenCalled();
  });
});
