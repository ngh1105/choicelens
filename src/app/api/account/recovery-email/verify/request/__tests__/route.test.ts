import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/request-user", () => ({
  getRequestUser: vi.fn(),
}));

vi.mock("@/lib/auth/emailVerify", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/emailVerify")
  >("@/lib/auth/emailVerify");
  return {
    ...actual,
    requestEmailVerifyOtp: vi.fn(),
  };
});

import { POST } from "../route";
import { getRequestUser } from "@/lib/request-user";
import {
  EmailVerifyError,
  requestEmailVerifyOtp,
} from "@/lib/auth/emailVerify";
import { OtpError } from "@/lib/auth/recoveryOtp";

const visitorUser = {
  id: "visitor_1",
  plan: "free",
  visitorId: "v_1",
  shouldSetCookie: false,
  authKind: "visitor" as const,
  walletAddress: null,
};

const walletUser = {
  ...visitorUser,
  id: "user_1",
  authKind: "wallet" as const,
  walletAddress: "0x0000000000000000000000000000000000000001",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestUser).mockResolvedValue(walletUser);
  vi.mocked(requestEmailVerifyOtp).mockResolvedValue({
    delivered: true,
    expiresAt: "2026-05-28T01:00:00Z",
  });
});

describe("POST /api/account/recovery-email/verify/request", () => {
  it("requires wallet session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(visitorUser);
    const res = await POST(new Request("http://test", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("returns delivered status on success", async () => {
    const res = await POST(new Request("http://test", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      delivered: true,
      expiresAt: "2026-05-28T01:00:00Z",
    });
  });

  it("maps recovery_email_missing to 400", async () => {
    vi.mocked(requestEmailVerifyOtp).mockRejectedValue(
      new EmailVerifyError("recovery_email_missing", "no"),
    );
    const res = await POST(new Request("http://test", { method: "POST" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "recovery_email_missing" });
  });

  it("maps recovery_email_already_verified to 409", async () => {
    vi.mocked(requestEmailVerifyOtp).mockRejectedValue(
      new EmailVerifyError("recovery_email_already_verified", "no"),
    );
    const res = await POST(new Request("http://test", { method: "POST" }));
    expect(res.status).toBe(409);
  });

  it("maps email_send_failed to 502", async () => {
    vi.mocked(requestEmailVerifyOtp).mockRejectedValue(
      new EmailVerifyError("email_send_failed", "no"),
    );
    const res = await POST(new Request("http://test", { method: "POST" }));
    expect(res.status).toBe(502);
  });

  it("maps otp_rate_limited to 429", async () => {
    vi.mocked(requestEmailVerifyOtp).mockRejectedValue(
      new OtpError("otp_rate_limited", "no"),
    );
    const res = await POST(new Request("http://test", { method: "POST" }));
    expect(res.status).toBe(429);
  });
});
