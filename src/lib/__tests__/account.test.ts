import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("../db", () => ({
  prisma: {
    $transaction: vi.fn(),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    walletLinkRequest: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../auth/siwe", async () => {
  const actual = await vi.importActual<typeof import("../auth/siwe")>(
    "../auth/siwe",
  );
  return {
    ...actual,
    verifySiweMessage: vi.fn(),
  };
});

import {
  confirmWalletChange,
  createWalletChangeRequest,
  getAccountSummary,
  parseRecoveryEmail,
  updateRecoveryEmail,
} from "../account";
import { verifySiweMessage } from "../auth/siwe";
import { prisma } from "../db";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("account helpers", () => {
  it("formats account summary without exposing secrets", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      plan: "plus",
      primaryWalletAddress: "0xabc",
      recoveryEmail: "name@example.com",
      stripeCustomerId: "cus_123",
      stripeSubscriptionStatus: "active",
      stripeCurrentPeriodEnd: new Date("2026-06-01T00:00:00.000Z"),
    } as never);

    await expect(getAccountSummary("user_1")).resolves.toEqual({
      plan: "plus",
      effectivePlan: "plus",
      primaryWalletAddress: "0xabc",
      recoveryEmail: "name@example.com",
      stripeCustomerId: "cus_123",
      stripeSubscriptionStatus: "active",
      stripeCurrentPeriodEnd: "2026-06-01T00:00:00.000Z",
    });
  });

  it("validates recovery email conservatively", () => {
    expect(parseRecoveryEmail(" Name@Example.COM ")).toBe("name@example.com");
    expect(parseRecoveryEmail("")).toBeNull();
    expect(() => parseRecoveryEmail("bad")).toThrow("Recovery email is invalid.");
  });

  it("stores recovery email for the current user only", async () => {
    vi.mocked(prisma.user.update).mockResolvedValue({
      recoveryEmail: "name@example.com",
    } as never);

    await expect(updateRecoveryEmail("user_1", "name@example.com")).resolves.toBe(
      "name@example.com",
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { recoveryEmail: "name@example.com" },
      select: { recoveryEmail: true },
    });
  });

  it("creates wallet change requests with a fresh nonce", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.walletLinkRequest.create).mockResolvedValue({
      id: "req_1",
      challengeNonce: "nonce_1",
      expiresAt: new Date("2026-05-23T00:10:00.000Z"),
    } as never);

    await expect(
      createWalletChangeRequest({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestedWalletAddress: "0x0000000000000000000000000000000000000002",
      }),
    ).resolves.toEqual({
      id: "req_1",
      challengeNonce: "nonce_1",
      expiresAt: "2026-05-23T00:10:00.000Z",
    });
    expect(prisma.walletLinkRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        requestedWalletAddress: "0x0000000000000000000000000000000000000002",
        status: "wallet_change_requested",
      }),
      select: {
        id: true,
        challengeNonce: true,
        expiresAt: true,
      },
    });
  });

  it("confirms wallet changes with a fresh signature from the new wallet", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "req_1",
      challengeNonce: "nonce_1",
      requestedWalletAddress: "0x0000000000000000000000000000000000000002",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0x0000000000000000000000000000000000000002",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.update).mockReturnValue({} as never);
    vi.mocked(prisma.walletLinkRequest.update).mockReturnValue({} as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);

    await expect(
      confirmWalletChange({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestId: "req_1",
        message: "siwe-message",
        signature: "0xsig",
      }),
    ).resolves.toEqual({
      walletAddress: "0x0000000000000000000000000000000000000002",
    });

    expect(verifySiweMessage).toHaveBeenCalledWith({
      message: "siwe-message",
      signature: "0xsig",
      nonce: "nonce_1",
      expectedAddress: "0x0000000000000000000000000000000000000002",
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
  });

  it("getAccountSummary throws account_not_found when user is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(getAccountSummary("ghost")).rejects.toMatchObject({
      code: "account_not_found",
    });
  });

  it("parseRecoveryEmail rejects non-string values, oversized strings, and bad shapes", () => {
    expect(() => parseRecoveryEmail(42)).toThrow("Recovery email is invalid.");
    expect(() => parseRecoveryEmail({})).toThrow("Recovery email is invalid.");
    const tooLong = `${"a".repeat(250)}@example.com`;
    expect(() => parseRecoveryEmail(tooLong)).toThrow();
    expect(() => parseRecoveryEmail("name @example.com")).toThrow();
    expect(() => parseRecoveryEmail("name@example")).toThrow();
    expect(parseRecoveryEmail(null)).toBeNull();
    expect(parseRecoveryEmail(undefined)).toBeNull();
  });

  it("createWalletChangeRequest requires a current wallet session", async () => {
    await expect(
      createWalletChangeRequest({
        userId: "user_1",
        currentWalletAddress: null,
        requestedWalletAddress: "0x0000000000000000000000000000000000000002",
      }),
    ).rejects.toMatchObject({ code: "wallet_session_required" });
    expect(prisma.walletLinkRequest.create).not.toHaveBeenCalled();
  });

  it("createWalletChangeRequest rejects non-string requested wallets", async () => {
    await expect(
      createWalletChangeRequest({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestedWalletAddress: 42,
      }),
    ).rejects.toMatchObject({ code: "wallet_invalid" });
  });

  it("createWalletChangeRequest rejects re-linking the same wallet", async () => {
    await expect(
      createWalletChangeRequest({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestedWalletAddress: "0x0000000000000000000000000000000000000001",
      }),
    ).rejects.toMatchObject({ code: "wallet_same_as_current" });
  });

  it("createWalletChangeRequest rejects wallets already linked to another account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_other",
    } as never);

    await expect(
      createWalletChangeRequest({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestedWalletAddress: "0x0000000000000000000000000000000000000002",
      }),
    ).rejects.toMatchObject({ code: "wallet_already_linked" });
    expect(prisma.walletLinkRequest.create).not.toHaveBeenCalled();
  });

  it("confirmWalletChange requires a current wallet session", async () => {
    await expect(
      confirmWalletChange({
        userId: "user_1",
        currentWalletAddress: null,
        requestId: "req_1",
        message: "msg",
        signature: "sig",
      }),
    ).rejects.toMatchObject({ code: "wallet_session_required" });
    expect(verifySiweMessage).not.toHaveBeenCalled();
  });

  it("confirmWalletChange treats missing requestId/message/signature as wallet_change_not_found", async () => {
    await expect(
      confirmWalletChange({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestId: null,
        message: "msg",
        signature: "sig",
      }),
    ).rejects.toMatchObject({ code: "wallet_change_not_found" });
    expect(prisma.walletLinkRequest.findFirst).not.toHaveBeenCalled();
  });

  it("confirmWalletChange throws wallet_change_not_found when no matching request exists", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue(null);

    await expect(
      confirmWalletChange({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestId: "req_missing",
        message: "msg",
        signature: "sig",
      }),
    ).rejects.toMatchObject({ code: "wallet_change_not_found" });
    expect(verifySiweMessage).not.toHaveBeenCalled();
  });

  it("confirmWalletChange rejects when SIWE-verified wallet matches current", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "req_1",
      challengeNonce: "nonce_1",
      requestedWalletAddress: "0x0000000000000000000000000000000000000001",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0x0000000000000000000000000000000000000001",
    });

    await expect(
      confirmWalletChange({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestId: "req_1",
        message: "msg",
        signature: "sig",
      }),
    ).rejects.toMatchObject({ code: "wallet_same_as_current" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("confirmWalletChange rejects when verified wallet is already linked elsewhere", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "req_1",
      challengeNonce: "nonce_1",
      requestedWalletAddress: "0x0000000000000000000000000000000000000002",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0x0000000000000000000000000000000000000002",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_other",
    } as never);

    await expect(
      confirmWalletChange({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestId: "req_1",
        message: "msg",
        signature: "sig",
      }),
    ).rejects.toMatchObject({ code: "wallet_already_linked" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("confirmWalletChange maps a P2002 race in $transaction to wallet_already_linked", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "req_1",
      challengeNonce: "nonce_1",
      requestedWalletAddress: "0x0000000000000000000000000000000000000002",
    } as never);
    vi.mocked(verifySiweMessage).mockResolvedValue({
      walletAddress: "0x0000000000000000000000000000000000000002",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.update).mockReturnValue({} as never);
    vi.mocked(prisma.walletLinkRequest.update).mockReturnValue({} as never);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(
      confirmWalletChange({
        userId: "user_1",
        currentWalletAddress: "0x0000000000000000000000000000000000000001",
        requestId: "req_1",
        message: "msg",
        signature: "sig",
      }),
    ).rejects.toMatchObject({ code: "wallet_already_linked" });
  });
});
