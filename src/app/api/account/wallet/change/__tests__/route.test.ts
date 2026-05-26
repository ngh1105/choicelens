import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/request-user", () => ({
  getRequestUser: vi.fn(),
}));

vi.mock("@/lib/account", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account")>(
    "@/lib/account",
  );
  return {
    ...actual,
    createWalletChangeRequest: vi.fn(),
  };
});

import { POST } from "../route";
import { createWalletChangeRequest } from "@/lib/account";
import { getRequestUser } from "@/lib/request-user";

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

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/account/wallet/change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestUser).mockResolvedValue(walletUser);
  vi.mocked(createWalletChangeRequest).mockResolvedValue({
    id: "req_1",
    challengeNonce: "nonce_1",
    expiresAt: "2026-05-26T00:10:00.000Z",
  });
});

describe("POST /api/account/wallet/change", () => {
  it("requires a wallet session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(visitorUser);

    const res = await POST(
      jsonRequest({
        requestedWalletAddress: "0x0000000000000000000000000000000000000002",
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wallet_session_required" });
    expect(createWalletChangeRequest).not.toHaveBeenCalled();
  });

  it("returns the new wallet-link request with 201 on success", async () => {
    const res = await POST(
      jsonRequest({
        requestedWalletAddress: "0x0000000000000000000000000000000000000002",
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      walletChangeRequest: {
        id: "req_1",
        challengeNonce: "nonce_1",
        expiresAt: "2026-05-26T00:10:00.000Z",
      },
    });
    expect(createWalletChangeRequest).toHaveBeenCalledWith({
      userId: "user_1",
      currentWalletAddress: "0x0000000000000000000000000000000000000001",
      requestedWalletAddress: "0x0000000000000000000000000000000000000002",
    });
  });

  it("returns 409 when the requested wallet is already linked elsewhere", async () => {
    const { AccountError } = await vi.importActual<
      typeof import("@/lib/account")
    >("@/lib/account");
    vi.mocked(createWalletChangeRequest).mockRejectedValue(
      new AccountError("wallet_already_linked", "taken"),
    );

    const res = await POST(
      jsonRequest({
        requestedWalletAddress: "0x0000000000000000000000000000000000000002",
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wallet_already_linked" });
  });

  it("returns 400 for invalid wallet input", async () => {
    const { AccountError } = await vi.importActual<
      typeof import("@/lib/account")
    >("@/lib/account");
    vi.mocked(createWalletChangeRequest).mockRejectedValue(
      new AccountError("wallet_invalid", "bad address"),
    );

    const res = await POST(jsonRequest({ requestedWalletAddress: "nope" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "wallet_invalid" });
  });

  it("rejects bodies that are not JSON", async () => {
    const req = new Request("http://test/api/account/wallet/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(createWalletChangeRequest).not.toHaveBeenCalled();
  });
});
