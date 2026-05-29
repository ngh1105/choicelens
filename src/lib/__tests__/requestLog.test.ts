import { describe, expect, it, vi } from "vitest";
import { getRequestId, logRequestError } from "../requestLog";

describe("requestLog", () => {
  it("uses incoming request id when present", () => {
    const request = new Request("http://test", {
      headers: { "x-request-id": "req_123" },
    });

    expect(getRequestId(request)).toBe("req_123");
  });

  it("falls back to a generated id", () => {
    const id = getRequestId(new Request("http://test"));

    expect(id).toMatch(/[0-9a-f-]{36}/i);
  });

  it("logs structured errors without undefined context values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logRequestError("req_1", "POST /api/example failed", new Error("boom"), {
      userId: "user_1",
      omitted: undefined,
    });

    expect(spy).toHaveBeenCalledWith(
      "[request_error]",
      JSON.stringify({
        requestId: "req_1",
        message: "POST /api/example failed",
        error: { name: "Error", message: "boom" },
        context: { userId: "user_1" },
      }),
    );
  });
});
