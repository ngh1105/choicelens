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
    confirmEmailVerifyOtp: vi.fn(),
  };
});

import { POST } from "../route";
import { getRequestUser } from "@/lib/request-user";
import {
  EmailVerifyError,
  confirmEmailVerifyOtp,
} from "@/lib/auth/emailVerify";
import { OtpError } from "@/lib/auth/recoveryOtp";

const walletUser = {
  id: "user_1",
  plan: "free",
  visitorId: "v_1",
  shouldSetCookie: false,
  authKind: "wallet" as const,
  walletAddress: "0x0000000000000000000000000000000000000001",
};

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/account/recovery-email/verify/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestUser).mockResolvedValue(walletUser);
  vi.mocked(confirmEmailVerifyOtp).mockResolvedValue({
    recoveryEmail: "a@b.c",
    recoveryEmailVerifiedAt: "2026-05-28T01:00:00Z",
  });
});

describe("POST /api/account/recovery-email/verify/confirm", () => {
  it("requires wallet session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue({
      ...walletUser,
      authKind: "visitor",
      walletAddress: null,
    } as never);
    const res = await POST(jsonRequest({ code: "123456" }));
    expect(res.status).toBe(401);
  });

  it("returns the new verification timestamp", async () => {
    const res = await POST(jsonRequest({ code: "123456" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      recoveryEmail: "a@b.c",
      recoveryEmailVerifiedAt: "2026-05-28T01:00:00Z",
    });
  });

  it("maps OtpError to 400", async () => {
    vi.mocked(confirmEmailVerifyOtp).mockRejectedValue(
      new OtpError("otp_invalid_or_expired", "no"),
    );
    const res = await POST(jsonRequest({ code: "999999" }));
    expect(res.status).toBe(400);
  });

  it("maps recovery_email_already_verified to 409", async () => {
    vi.mocked(confirmEmailVerifyOtp).mockRejectedValue(
      new EmailVerifyError("recovery_email_already_verified", "no"),
    );
    const res = await POST(jsonRequest({ code: "123456" }));
    expect(res.status).toBe(409);
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });
});
