import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/visitor", () => ({
  getOrCreateVisitorUser: vi.fn(),
  visitorJson: (
    _visitor: unknown,
    body: unknown,
    init?: { status?: number },
  ) =>
    new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("@/lib/auth/walletSession", () => ({
  applyWalletSessionCookie: <T,>(response: T) => response,
  createWalletSessionToken: () => "session_token",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/siwe", () => ({
  verifySiweForUser: vi.fn(),
  isSiweAuthError: (value: unknown) =>
    value instanceof Error && (value as { name?: string }).name === "SiweAuthError",
}));

import { POST } from "../route";
import { getOrCreateVisitorUser } from "@/lib/visitor";
import { prisma } from "@/lib/db";
import { verifySiweForUser } from "@/lib/auth/siwe";

class FakeSiweError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SiweAuthError";
  }
}

const VISITOR = {
  id: "user_1",
  plan: "free",
  visitorId: "v_1",
  shouldSetCookie: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrCreateVisitorUser).mockResolvedValue(VISITOR as never);
  vi.mocked(verifySiweForUser).mockResolvedValue({
    walletAddress: "0xCAfe0000000000000000000000000000000000fe",
  });
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.update).mockResolvedValue({
    id: "user_1",
    plan: "free",
    primaryWalletAddress: "0xCAfe0000000000000000000000000000000000fe",
    recoveryEmail: null,
    stripeSubscriptionStatus: null,
    stripeCurrentPeriodEnd: null,
  } as never);
});

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/auth/siwe/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/siwe/verify", () => {
  it("links the wallet to the visitor user and returns the account summary", async () => {
    const res = await POST(jsonRequest({ message: "msg", signature: "sig" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      account: {
        id: "user_1",
        plan: "free",
        primaryWalletAddress: "0xCAfe0000000000000000000000000000000000fe",
        recoveryEmail: null,
        stripeSubscriptionStatus: null,
        stripeCurrentPeriodEnd: null,
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: expect.objectContaining({
        primaryWalletAddress: "0xCAfe0000000000000000000000000000000000fe",
      }),
      select: expect.any(Object),
    });
  });

  it("rejects payloads missing message or signature", async () => {
    const res = await POST(jsonRequest({ message: "msg" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
    expect(verifySiweForUser).not.toHaveBeenCalled();
  });

  it("returns 409 when the wallet is already linked to a different user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_other",
    } as never);

    const res = await POST(jsonRequest({ message: "msg", signature: "sig" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wallet_already_linked" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("maps nonce_not_found to 410", async () => {
    vi.mocked(verifySiweForUser).mockRejectedValue(
      new FakeSiweError("nonce_not_found", "expired"),
    );

    const res = await POST(jsonRequest({ message: "msg", signature: "sig" }));

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "nonce_not_found" });
  });

  it("maps siwe_rejected to 400", async () => {
    vi.mocked(verifySiweForUser).mockRejectedValue(
      new FakeSiweError("siwe_rejected", "bad signature"),
    );

    const res = await POST(jsonRequest({ message: "msg", signature: "sig" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "siwe_rejected" });
  });

  it("returns 409 wallet_already_linked when the update races a unique-constraint conflict", async () => {
    vi.mocked(prisma.user.update).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = await POST(jsonRequest({ message: "msg", signature: "sig" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wallet_already_linked" });
  });
});
