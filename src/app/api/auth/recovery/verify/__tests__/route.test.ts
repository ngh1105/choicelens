import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/recovery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/recovery")>(
    "@/lib/auth/recovery",
  );
  return {
    ...actual,
    verifyRecoveryOtp: vi.fn(),
  };
});

import { POST } from "../route";
import { verifyRecoveryOtp, RecoveryError } from "@/lib/auth/recovery";
import { OtpError } from "@/lib/auth/recoveryOtp";

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/auth/recovery/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyRecoveryOtp).mockResolvedValue({
    recoveryToken: "tok",
    expiresAt: "2026-05-28T01:00:00Z",
  });
});

describe("POST /api/auth/recovery/verify", () => {
  it("returns the token on success", async () => {
    const res = await POST(jsonRequest({ email: "a@b.c", code: "123456" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      recoveryToken: "tok",
      expiresAt: "2026-05-28T01:00:00Z",
    });
  });

  it("maps OtpError invalid_or_expired to 400", async () => {
    vi.mocked(verifyRecoveryOtp).mockRejectedValue(
      new OtpError("otp_invalid_or_expired", "no"),
    );
    const res = await POST(jsonRequest({ email: "a@b.c", code: "111111" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "otp_invalid_or_expired" });
  });

  it("maps OtpError rate_limited to 429", async () => {
    vi.mocked(verifyRecoveryOtp).mockRejectedValue(
      new OtpError("otp_rate_limited", "no"),
    );
    const res = await POST(jsonRequest({ email: "a@b.c", code: "111111" }));
    expect(res.status).toBe(429);
  });

  it("maps RecoveryError recovery_locked to 423", async () => {
    vi.mocked(verifyRecoveryOtp).mockRejectedValue(
      new RecoveryError("recovery_locked", "no"),
    );
    const res = await POST(jsonRequest({ email: "a@b.c", code: "111111" }));
    expect(res.status).toBe(423);
  });
});
