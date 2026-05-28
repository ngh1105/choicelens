import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    emailOtp: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import {
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_MAX,
  RECOVERY_OTP_PURPOSE,
  consumeOtp,
  generateOtpCode,
  hashOtpCode,
  isOtpError,
  issueOtp,
} from "../recoveryOtp";
import { prisma } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateOtpCode / hashOtpCode", () => {
  it("returns a 6-digit decimal string", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("hashOtpCode returns a deterministic 64-char hex digest", () => {
    expect(hashOtpCode("123456")).toBe(hashOtpCode("123456"));
    expect(hashOtpCode("123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtpCode("123456")).not.toBe(hashOtpCode("123457"));
  });
});

describe("issueOtp", () => {
  it("creates an EmailOtp row with hashed code and 10 minute TTL", async () => {
    vi.mocked(prisma.emailOtp.count).mockResolvedValue(0);
    const expiresAt = new Date("2026-05-28T00:10:00Z");
    vi.mocked(prisma.emailOtp.create).mockResolvedValue({
      id: "otp_1",
      expiresAt,
    } as never);

    const issued = await issueOtp({
      email: "alice@example.com",
      userId: "user_1",
      purpose: RECOVERY_OTP_PURPOSE,
    });

    expect(issued.id).toBe("otp_1");
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.expiresAt).toEqual(expiresAt);

    const args = vi.mocked(prisma.emailOtp.create).mock.calls[0][0];
    expect(args).toMatchObject({
      data: expect.objectContaining({
        email: "alice@example.com",
        userId: "user_1",
        purpose: RECOVERY_OTP_PURPOSE,
        codeHash: hashOtpCode(issued.code),
      }),
    });
  });

  it("throws otp_rate_limited when window is at capacity", async () => {
    vi.mocked(prisma.emailOtp.count).mockResolvedValue(OTP_RATE_LIMIT_MAX);

    await expect(
      issueOtp({
        email: "alice@example.com",
        userId: "user_1",
        purpose: RECOVERY_OTP_PURPOSE,
      }),
    ).rejects.toMatchObject({ code: "otp_rate_limited" });
    expect(prisma.emailOtp.create).not.toHaveBeenCalled();
  });
});

describe("consumeOtp", () => {
  const valid = "123456";
  const otpRow = {
    id: "otp_1",
    userId: "user_1",
    email: "alice@example.com",
    codeHash: hashOtpCode(valid),
    attempts: 0,
  };

  it("consumes the row when code matches", async () => {
    vi.mocked(prisma.emailOtp.findFirst).mockResolvedValue(otpRow as never);
    vi.mocked(prisma.emailOtp.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await consumeOtp({
      email: otpRow.email,
      purpose: RECOVERY_OTP_PURPOSE,
      code: valid,
    });

    expect(result).toEqual({
      id: otpRow.id,
      userId: otpRow.userId,
      email: otpRow.email,
    });
    expect(prisma.emailOtp.update).not.toHaveBeenCalled();
  });

  it("throws otp_invalid_or_expired when no candidate row exists", async () => {
    vi.mocked(prisma.emailOtp.findFirst).mockResolvedValue(null);
    await expect(
      consumeOtp({ email: "x@y.z", purpose: RECOVERY_OTP_PURPOSE, code: valid }),
    ).rejects.toMatchObject({ code: "otp_invalid_or_expired" });
  });

  it("increments attempts on wrong code without consuming", async () => {
    vi.mocked(prisma.emailOtp.findFirst).mockResolvedValue(otpRow as never);
    vi.mocked(prisma.emailOtp.update).mockResolvedValue({} as never);

    await expect(
      consumeOtp({
        email: otpRow.email,
        purpose: RECOVERY_OTP_PURPOSE,
        code: "999999",
      }),
    ).rejects.toMatchObject({ code: "otp_invalid_or_expired" });

    expect(prisma.emailOtp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: otpRow.id },
        data: { attempts: 1 },
      }),
    );
  });

  it("invalidates the row after OTP_MAX_ATTEMPTS misses", async () => {
    vi.mocked(prisma.emailOtp.findFirst).mockResolvedValue({
      ...otpRow,
      attempts: OTP_MAX_ATTEMPTS - 1,
    } as never);
    vi.mocked(prisma.emailOtp.update).mockResolvedValue({} as never);

    await expect(
      consumeOtp({
        email: otpRow.email,
        purpose: RECOVERY_OTP_PURPOSE,
        code: "999999",
      }),
    ).rejects.toMatchObject({ code: "otp_invalid_or_expired" });

    const updateArgs = vi.mocked(prisma.emailOtp.update).mock.calls[0][0];
    expect(updateArgs.data).toMatchObject({
      attempts: OTP_MAX_ATTEMPTS,
      consumedAt: expect.any(Date),
    });
  });

  it("throws when atomic consume races and updateMany finds 0 rows", async () => {
    vi.mocked(prisma.emailOtp.findFirst).mockResolvedValue(otpRow as never);
    vi.mocked(prisma.emailOtp.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      consumeOtp({
        email: otpRow.email,
        purpose: RECOVERY_OTP_PURPOSE,
        code: valid,
      }),
    ).rejects.toMatchObject({ code: "otp_invalid_or_expired" });
  });

  it("isOtpError matches OtpError instances", async () => {
    vi.mocked(prisma.emailOtp.findFirst).mockResolvedValue(null);
    expect.assertions(1);
    try {
      await consumeOtp({
        email: "x@y.z",
        purpose: RECOVERY_OTP_PURPOSE,
        code: valid,
      });
    } catch (err) {
      expect(isOtpError(err)).toBe(true);
    }
  });
});
