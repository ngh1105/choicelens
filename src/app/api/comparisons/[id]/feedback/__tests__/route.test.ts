import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  saveComparisonFeedback: vi.fn(),
  StoreError: class StoreError extends Error {
    code: string;
    constructor(code: string, msg: string) {
      super(msg);
      this.code = code;
      this.name = "StoreError";
    }
  },
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

vi.mock("@/lib/analytics", () => ({
  trackServerEvent: vi.fn(),
}));

import { POST } from "../route";
import { trackServerEvent } from "@/lib/analytics";
import { saveComparisonFeedback, StoreError } from "@/lib/store";
import { getOrCreateVisitorUser } from "@/lib/visitor";

const visitor = {
  id: "user_visitor",
  plan: "free",
  visitorId: "v_testvisitor00000000000000000000000000000000",
  shouldSetCookie: false,
};

const feedback = {
  id: "fb1",
  comparisonId: "cmp1",
  helpful: true,
  createdAt: "2026-05-28T00:00:00.000Z",
};

function req(body: unknown): Request {
  return new Request("http://test/api/comparisons/cmp1/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-request-id": "req_1" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "cmp1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrCreateVisitorUser).mockResolvedValue(visitor);
  vi.mocked(saveComparisonFeedback).mockResolvedValue(feedback);
});

describe("POST /api/comparisons/[id]/feedback", () => {
  it("stores helpful feedback", async () => {
    const res = await POST(req({ helpful: true }), context);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ feedback, requestId: "req_1" });
    expect(saveComparisonFeedback).toHaveBeenCalledWith("user_visitor", {
      comparisonId: "cmp1",
      helpful: true,
    });
    expect(trackServerEvent).toHaveBeenCalledWith("result_helpful", {
      userId: "user_visitor",
      comparisonId: "cmp1",
      feedbackId: "fb1",
      requestId: "req_1",
    });
  });

  it("stores unhelpful feedback", async () => {
    vi.mocked(saveComparisonFeedback).mockResolvedValue({
      ...feedback,
      id: "fb2",
      helpful: false,
    });

    const res = await POST(req({ helpful: false }), context);

    expect(res.status).toBe(201);
    expect(trackServerEvent).toHaveBeenCalledWith("result_unhelpful", {
      userId: "user_visitor",
      comparisonId: "cmp1",
      feedbackId: "fb2",
      requestId: "req_1",
    });
  });

  it("rejects invalid payloads", async () => {
    const res = await POST(req({ helpful: "yes" }), context);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_input", requestId: "req_1" });
    expect(saveComparisonFeedback).not.toHaveBeenCalled();
    expect(trackServerEvent).not.toHaveBeenCalled();
  });

  it("404s when comparison is not owned by the visitor", async () => {
    vi.mocked(saveComparisonFeedback).mockRejectedValue(
      new StoreError("comparison_not_found", "Comparison not found"),
    );

    const res = await POST(req({ helpful: true }), context);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found", requestId: "req_1" });
    expect(trackServerEvent).not.toHaveBeenCalled();
  });
});
