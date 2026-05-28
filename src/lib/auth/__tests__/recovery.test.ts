import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    walletLinkRequest: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    emailOtp: { update: vi.fn() },
    $transaction: vi.fn(),
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

vi.mock("@/lib/auth/siwe", () => ({
  verifySiweMessage: vi.fn(),
  normalizeWalletAddress: (value: string) => value.toLowerCase(),
  isSiweAuthError: (value: unknown) =>
    value instanceof Error && (value as { name?: string }).name === "SiweAuthError",
  SiweAuthError: class SiweAuthError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "SiweAuthError";
    }
  },
}));

vi.mock("@/lib/auth/walletSession", () => ({
  createNonce: () => "nonce_abc",
}));

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
  sendRecoveryOtpEmail: vi.fn(),
}));

import {
  beginRecoveryWalletChallenge,
  confirmRecovery,
  RECOVERY_LOCKOUT_MS,
  requestRecoveryOtp,
  verifyRecoveryOtp,
} from "../recovery";
import { prisma } from "@/lib/db";
import {
  consumeOtp,
  issueOtp,
  OtpError,
} from "@/lib/auth/recoveryOtp";
import { verifySiweMessage } from "@/lib/auth/siwe";
import { isEmailEnabled } from "@/lib/email/resend";
import { sendRecoveryOtpEmail } from "@/lib/email/templates";
import { createRecoveryToken } from "../recoveryToken";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WALLET_SESSION_SECRET", "test-secret");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const email = "alice@example.com";

describe("requestRecoveryOtp", () => {
  it("noops silently when email is invalid", async () => {
    const res = await requestRecoveryOtp({ email: "not-an-email" });
    expect(res.delivered).toBe(false);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("noops silently when no verified user matches", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    const res = await requestRecoveryOtp({ email });
    expect(res.delivered).toBe(false);
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("noops silently when user is locked", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user_1",
      recoveryLockedUntil: new Date(Date.now() + 1_000_000),
    } as never);
    const res = await requestRecoveryOtp({ email });
    expect(res.delivered).toBe(false);
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("noops when rate limited", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user_1",
      recoveryLockedUntil: null,
    } as never);
    vi.mocked(issueOtp).mockRejectedValue(
      new OtpError("otp_rate_limited", "rate"),
    );
    const res = await requestRecoveryOtp({ email });
    expect(res.delivered).toBe(false);
  });

  it("issues an OTP and skips delivery when email provider is disabled", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user_1",
      recoveryLockedUntil: null,
    } as never);
    vi.mocked(issueOtp).mockResolvedValue({
      id: "otp_1",
      code: "123456",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await requestRecoveryOtp({ email });
    expect(res.delivered).toBe(false);
    expect(sendRecoveryOtpEmail).not.toHaveBeenCalled();
  });

  it("sends an email when provider is enabled and reports delivered=true", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user_1",
      recoveryLockedUntil: null,
    } as never);
    vi.mocked(issueOtp).mockResolvedValue({
      id: "otp_1",
      code: "123456",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(isEmailEnabled).mockReturnValue(true);
    vi.mocked(sendRecoveryOtpEmail).mockResolvedValue({ id: "msg_1" });

    const res = await requestRecoveryOtp({ email });

    expect(res.delivered).toBe(true);
    expect(sendRecoveryOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: email, code: "123456" }),
    );
  });
});

describe("verifyRecoveryOtp", () => {
  it("rejects invalid codes early", async () => {
    await expect(
      verifyRecoveryOtp({ email, code: "abc" }),
    ).rejects.toMatchObject({ code: "otp_invalid_or_expired" });
    expect(consumeOtp).not.toHaveBeenCalled();
  });

  it("returns a recovery token on success", async () => {
    vi.mocked(consumeOtp).mockResolvedValue({
      id: "otp_1",
      userId: "user_1",
      email,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryLockedUntil: null,
    } as never);

    const res = await verifyRecoveryOtp({ email, code: "123456" });

    expect(res.recoveryToken.split(".")).toHaveLength(2);
    expect(res.expiresAt).toEqual(expect.any(String));
  });

  it("throws recovery_locked when account locked between request and verify", async () => {
    vi.mocked(consumeOtp).mockResolvedValue({
      id: "otp_1",
      userId: "user_1",
      email,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      recoveryLockedUntil: new Date(Date.now() + 1_000_000),
    } as never);

    await expect(
      verifyRecoveryOtp({ email, code: "123456" }),
    ).rejects.toMatchObject({ code: "recovery_locked" });
  });
});

describe("beginRecoveryWalletChallenge", () => {
  it("creates a recovery_nonce for the token's user", async () => {
    const token = createRecoveryToken({
      userId: "user_1",
      email,
      otpId: "otp_1",
    });
    vi.mocked(prisma.walletLinkRequest.create).mockResolvedValue({} as never);

    const res = await beginRecoveryWalletChallenge({ recoveryToken: token });

    expect(res.nonce).toBe("nonce_abc");
    expect(prisma.walletLinkRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user_1",
          status: "recovery_nonce",
          challengeNonce: "nonce_abc",
        }),
      }),
    );
  });

  it("throws when token is invalid", async () => {
    await expect(
      beginRecoveryWalletChallenge({ recoveryToken: "garbage" }),
    ).rejects.toMatchObject({ code: "recovery_token_invalid" });
  });
});

describe("confirmRecovery", () => {
  function tokenFor(userId = "user_1") {
    return createRecoveryToken({ userId, email, otpId: "otp_1" });
  }

  it("verifies SIWE, swaps wallet, and sets recovery lock", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "wlr_1",
      challengeNonce: "nonce_abc",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0xnew",
    });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        id: "user_1",
        primaryWalletAddress: "0xold",
        recoveryLockedUntil: null,
      } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);

    const res = await confirmRecovery({
      recoveryToken: tokenFor(),
      message: "siwe",
      signature: "sig",
    });

    expect(res.userId).toBe("user_1");
    expect(res.walletAddress).toBe("0xnew");
    const lockedUntil = new Date(res.recoveryLockedUntil).getTime();
    expect(lockedUntil).toBeGreaterThan(
      Date.now() + RECOVERY_LOCKOUT_MS - 60_000,
    );
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("rejects when nonce row missing", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue(null);
    await expect(
      confirmRecovery({
        recoveryToken: tokenFor(),
        message: "m",
        signature: "s",
      }),
    ).rejects.toMatchObject({ code: "recovery_token_invalid" });
  });

  it("rejects when new wallet matches current primary", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "wlr_1",
      challengeNonce: "nonce_abc",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0xold",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user_1",
      primaryWalletAddress: "0xold",
      recoveryLockedUntil: null,
    } as never);

    await expect(
      confirmRecovery({
        recoveryToken: tokenFor(),
        message: "m",
        signature: "s",
      }),
    ).rejects.toMatchObject({ code: "wallet_same_as_current" });
  });

  it("rejects when wallet already linked elsewhere", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "wlr_1",
      challengeNonce: "nonce_abc",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0xnew",
    });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        id: "user_1",
        primaryWalletAddress: "0xold",
        recoveryLockedUntil: null,
      } as never)
      .mockResolvedValueOnce({ id: "user_other" } as never);

    await expect(
      confirmRecovery({
        recoveryToken: tokenFor(),
        message: "m",
        signature: "s",
      }),
    ).rejects.toMatchObject({ code: "wallet_already_linked" });
  });

  it("rejects when user is locked", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "wlr_1",
      challengeNonce: "nonce_abc",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0xnew",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user_1",
      primaryWalletAddress: "0xold",
      recoveryLockedUntil: new Date(Date.now() + 1_000_000),
    } as never);

    await expect(
      confirmRecovery({
        recoveryToken: tokenFor(),
        message: "m",
        signature: "s",
      }),
    ).rejects.toMatchObject({ code: "recovery_locked" });
  });
});
