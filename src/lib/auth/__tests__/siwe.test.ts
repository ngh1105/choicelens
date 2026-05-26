import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const siweVerify = vi.fn();

vi.mock("siwe", () => ({
  SiweMessage: vi.fn().mockImplementation((arg: unknown) => {
    let parsed: Record<string, unknown> = {};
    if (typeof arg === "string") {
      try {
        const obj = JSON.parse(arg);
        if (obj && typeof obj === "object") {
          parsed = obj as Record<string, unknown>;
        }
      } catch {
        // not JSON — treat as opaque message
      }
    } else if (arg && typeof arg === "object") {
      parsed = arg as Record<string, unknown>;
    }
    return {
      verify: siweVerify,
      address: parsed.address ?? "0x0000000000000000000000000000000000000001",
      domain: parsed.domain ?? "test.local",
      nonce: parsed.nonce ?? "nonce_1",
      prepareMessage: () => "prepared",
    };
  }),
}));

vi.mock("../../db", () => ({
  prisma: {
    walletLinkRequest: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import {
  SiweAuthError,
  SIWE_NONCE_TTL_MS,
  appBaseUrl,
  createSiweNonce,
  isSiweAuthError,
  normalizeWalletAddress,
  verifySiweForUser,
  verifySiweMessage,
} from "../siwe";
import { prisma } from "../../db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_BASE_URL", "https://test.local");
  siweVerify.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appBaseUrl", () => {
  it("uses APP_BASE_URL when set", () => {
    vi.stubEnv("APP_BASE_URL", "https://choice.test");
    expect(appBaseUrl().toString()).toBe("https://choice.test/");
  });

  it("falls back to localhost:3000 when APP_BASE_URL is missing", () => {
    vi.stubEnv("APP_BASE_URL", "");
    expect(appBaseUrl().toString()).toBe("http://localhost:3000/");
  });
});

describe("normalizeWalletAddress", () => {
  it("returns the EIP-55 checksum form for valid addresses", () => {
    expect(
      normalizeWalletAddress("0x0000000000000000000000000000000000000001"),
    ).toBe("0x0000000000000000000000000000000000000001");
  });

  it("uppercases mixed-case input into checksummed form", () => {
    expect(
      normalizeWalletAddress("0x52908400098527886e0f7030069857d2e4169ee7"),
    ).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
  });

  it("throws SiweAuthError for non-address strings", () => {
    expect(() => normalizeWalletAddress("not-an-address")).toThrow(SiweAuthError);
    try {
      normalizeWalletAddress("not-an-address");
    } catch (err) {
      expect(isSiweAuthError(err)).toBe(true);
      if (isSiweAuthError(err)) expect(err.code).toBe("invalid_wallet");
    }
  });
});

describe("createSiweNonce", () => {
  it("creates a wallet_link_request with siwe_nonce status and TTL", async () => {
    vi.mocked(prisma.walletLinkRequest.create).mockResolvedValue({} as never);
    const before = Date.now();

    const nonce = await createSiweNonce("user_1");
    const callArgs = vi.mocked(prisma.walletLinkRequest.create).mock.calls[0]?.[0];

    expect(typeof nonce).toBe("string");
    expect(nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(callArgs?.data).toMatchObject({
      userId: "user_1",
      challengeNonce: nonce,
      status: "siwe_nonce",
      requestedWalletAddress: "0x0000000000000000000000000000000000000000",
    });
    const expiresAt = callArgs?.data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SIWE_NONCE_TTL_MS - 100);
  });
});

describe("verifySiweMessage", () => {
  it("returns the verified wallet address on success", async () => {
    siweVerify.mockResolvedValueOnce({ success: true });

    const result = await verifySiweMessage({
      message: JSON.stringify({
        address: "0x0000000000000000000000000000000000000001",
      }),
      signature: "0xsig",
      nonce: "nonce_1",
    });

    expect(result.walletAddress).toBe(
      "0x0000000000000000000000000000000000000001",
    );
    expect(siweVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: "0xsig",
        domain: "test.local",
        nonce: "nonce_1",
      }),
      { suppressExceptions: true },
    );
  });

  it("throws siwe_rejected when verify reports failure", async () => {
    siweVerify.mockResolvedValueOnce({ success: false });

    await expect(
      verifySiweMessage({
        message: "{}",
        signature: "0xsig",
        nonce: "nonce_1",
      }),
    ).rejects.toMatchObject({ code: "siwe_rejected" });
  });

  it("throws siwe_rejected when expectedAddress does not match the verified wallet", async () => {
    siweVerify.mockResolvedValueOnce({ success: true });

    await expect(
      verifySiweMessage({
        message: JSON.stringify({
          address: "0x0000000000000000000000000000000000000001",
        }),
        signature: "0xsig",
        nonce: "nonce_1",
        expectedAddress: "0x0000000000000000000000000000000000000002",
      }),
    ).rejects.toMatchObject({ code: "siwe_rejected" });
  });
});

describe("verifySiweForUser", () => {
  it("throws nonce_not_found when no live nonce row matches", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue(null);

    await expect(
      verifySiweForUser({
        userId: "user_1",
        message: JSON.stringify({
          nonce: "nonce_1",
          domain: "test.local",
        }),
        signature: "0xsig",
      }),
    ).rejects.toMatchObject({ code: "nonce_not_found" });
    expect(siweVerify).not.toHaveBeenCalled();
  });

  it("throws siwe_rejected when SIWE domain does not match APP_BASE_URL", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "req_1",
    } as never);

    await expect(
      verifySiweForUser({
        userId: "user_1",
        message: JSON.stringify({
          nonce: "nonce_1",
          domain: "evil.example",
        }),
        signature: "0xsig",
      }),
    ).rejects.toMatchObject({ code: "siwe_rejected" });
    expect(siweVerify).not.toHaveBeenCalled();
  });

  it("marks the nonce row used after a successful SIWE verify", async () => {
    vi.mocked(prisma.walletLinkRequest.findFirst).mockResolvedValue({
      id: "req_1",
    } as never);
    vi.mocked(prisma.walletLinkRequest.update).mockResolvedValue({} as never);
    siweVerify.mockResolvedValueOnce({ success: true });

    const result = await verifySiweForUser({
      userId: "user_1",
      message: JSON.stringify({
        nonce: "nonce_1",
        domain: "test.local",
        address: "0x0000000000000000000000000000000000000001",
      }),
      signature: "0xsig",
    });

    expect(result.walletAddress).toBe(
      "0x0000000000000000000000000000000000000001",
    );
    expect(prisma.walletLinkRequest.update).toHaveBeenCalledWith({
      where: { id: "req_1" },
      data: expect.objectContaining({ status: "used" }),
    });
  });
});

describe("isSiweAuthError", () => {
  it("identifies SiweAuthError instances", () => {
    expect(isSiweAuthError(new SiweAuthError("invalid_wallet", "x"))).toBe(true);
    expect(isSiweAuthError(new Error("plain"))).toBe(false);
    expect(isSiweAuthError(null)).toBe(false);
    expect(isSiweAuthError("string")).toBe(false);
  });
});
