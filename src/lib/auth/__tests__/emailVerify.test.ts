import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/auth/recoveryOtp", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/recoveryOtp")
  >("@/lib/auth/recoveryOtp");
  return {
    ...actual,
    issueOtp: vi.fn(),
    consumeOtp: vi.fn(),
  };
});

vi.mock("@/lib/email/resend", () => ({
  isEmailEnabled: vi.fn(() => false),
  isEmailSendError: (value: unknown) =>
    value instanceof Error &&
    (value as { name?: string }).name === "EmailSendError",
  EmailSendError: class EmailSendError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "EmailSendError";
    }
  },
}));

vi.mock("@/lib/email/templates", () => ({
  sendEmailVerifyOtpEmail: vi.fn(),
}));

import {
  confirmEmailVerifyOtp,
  EmailVerifyError,
  requestEmailVerifyOtp,
} from "../emailVerify";
import { prisma } from "@/lib/db";
import {
  consumeOtp,
  EMAIL_VERIFY_OTP_PURPOSE,
  issueOtp,
  OtpError,
} from "@/lib/auth/recoveryOtp";
import { isEmailEnabled } from "@/lib/email/resend";
import { sendEmailVerifyOtpEmail } from "@/lib/email/templates";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requestEmailVerifyOtp", () => {
  it("rejects when no recovery email is set", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryEmail: null,
      recoveryEmailVerifiedAt: null,
    } as never);

    await expect(
      requestEmailVerifyOtp({ userId: "user_1" }),
    ).rejects.toMatchObject({ code: "recovery_email_missing" });
  });

  it("rejects when already verified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryEmail: "a@b.c",
      recoveryEmailVerifiedAt: new Date(),
    } as never);

    await expect(
      requestEmailVerifyOtp({ userId: "user_1" }),
    ).rejects.toMatchObject({ code: "recovery_email_already_verified" });
  });

  it("issues an OTP and returns delivered=false when email provider is off", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryEmail: "a@b.c",
      recoveryEmailVerifiedAt: null,
    } as never);
    vi.mocked(issueOtp).mockResolvedValue({
      id: "otp_1",
      code: "123456",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await requestEmailVerifyOtp({ userId: "user_1" });

    expect(res.delivered).toBe(false);
    expect(issueOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@b.c",
        userId: "user_1",
        purpose: EMAIL_VERIFY_OTP_PURPOSE,
      }),
    );
    expect(sendEmailVerifyOtpEmail).not.toHaveBeenCalled();
  });

  it("sends an email when provider is enabled", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryEmail: "a@b.c",
      recoveryEmailVerifiedAt: null,
    } as never);
    vi.mocked(issueOtp).mockResolvedValue({
      id: "otp_1",
      code: "123456",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(isEmailEnabled).mockReturnValue(true);
    vi.mocked(sendEmailVerifyOtpEmail).mockResolvedValue({ id: "msg_1" });

    const res = await requestEmailVerifyOtp({ userId: "user_1" });

    expect(res.delivered).toBe(true);
    expect(sendEmailVerifyOtpEmail).toHaveBeenCalled();
  });
});

describe("confirmEmailVerifyOtp", () => {
  it("rejects malformed codes early", async () => {
    await expect(
      confirmEmailVerifyOtp({ userId: "user_1", code: "abc" }),
    ).rejects.toBeInstanceOf(OtpError);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when user has no recovery email", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryEmail: null,
      recoveryEmailVerifiedAt: null,
    } as never);

    await expect(
      confirmEmailVerifyOtp({ userId: "user_1", code: "123456" }),
    ).rejects.toBeInstanceOf(EmailVerifyError);
  });

  it("rejects when already verified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryEmail: "a@b.c",
      recoveryEmailVerifiedAt: new Date(),
    } as never);

    await expect(
      confirmEmailVerifyOtp({ userId: "user_1", code: "123456" }),
    ).rejects.toMatchObject({ code: "recovery_email_already_verified" });
  });

  it("consumes OTP scoped to userId and stamps recoveryEmailVerifiedAt", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryEmail: "a@b.c",
      recoveryEmailVerifiedAt: null,
    } as never);
    vi.mocked(consumeOtp).mockResolvedValue({
      id: "otp_1",
      userId: "user_1",
      email: "a@b.c",
    });
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await confirmEmailVerifyOtp({
      userId: "user_1",
      code: "123456",
    });

    expect(res.recoveryEmail).toBe("a@b.c");
    expect(res.recoveryEmailVerifiedAt).toEqual(expect.any(String));
    expect(consumeOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@b.c",
        purpose: EMAIL_VERIFY_OTP_PURPOSE,
        userId: "user_1",
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: expect.objectContaining({
        recoveryEmailVerifiedAt: expect.any(Date),
      }),
    });
  });
});
