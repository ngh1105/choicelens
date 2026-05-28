import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/recovery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/recovery")>(
    "@/lib/auth/recovery",
  );
  return {
    ...actual,
    requestRecoveryOtp: vi.fn(),
  };
});

import { POST } from "../route";
import { requestRecoveryOtp } from "@/lib/auth/recovery";

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/auth/recovery/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requestRecoveryOtp).mockResolvedValue({ delivered: true });
});

describe("POST /api/auth/recovery/request", () => {
  it("returns 204 on success", async () => {
    const res = await POST(jsonRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(204);
  });

  it("returns 204 even when email is invalid (no enumeration leak)", async () => {
    vi.mocked(requestRecoveryOtp).mockResolvedValue({ delivered: false });
    const res = await POST(jsonRequest({ email: "bad" }));
    expect(res.status).toBe(204);
  });

  it("rejects non-JSON body with 400", async () => {
    const res = await POST(
      new Request("http://test/api/auth/recovery/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(requestRecoveryOtp).not.toHaveBeenCalled();
  });

  it("returns 204 when the recovery layer throws (no enumeration leak)", async () => {
    vi.mocked(requestRecoveryOtp).mockRejectedValue(new Error("db dead"));
    const res = await POST(jsonRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(204);
  });
});
