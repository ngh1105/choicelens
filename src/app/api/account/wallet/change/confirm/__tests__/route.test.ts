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
    confirmWalletChange: vi.fn(),
  };
});

import { POST } from "../route";
import { confirmWalletChange } from "@/lib/account";
import { getRequestUser } from "@/lib/request-user";
import { WALLET_SESSION_COOKIE_NAME } from "@/lib/auth/walletSession";

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

function request(body: unknown): Request {
  return new Request("http://test/api/account/wallet/change/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestUser).mockResolvedValue(walletUser);
  vi.mocked(confirmWalletChange).mockResolvedValue({
    walletAddress: "0x0000000000000000000000000000000000000002",
  });
});

describe("POST /api/account/wallet/change/confirm", () => {
  it("requires current wallet session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(visitorUser);

    const res = await POST(
      request({ requestId: "req_1", message: "msg", signature: "sig" }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wallet_session_required" });
    expect(confirmWalletChange).not.toHaveBeenCalled();
  });

  it("confirms and rotates the wallet session cookie", async () => {
    const res = await POST(
      request({ requestId: "req_1", message: "msg", signature: "sig" }),
    );

    expect(res.status).toBe(200);
    expect(confirmWalletChange).toHaveBeenCalledWith({
      userId: "user_1",
      currentWalletAddress: "0x0000000000000000000000000000000000000001",
      requestId: "req_1",
      message: "msg",
      signature: "sig",
    });
    expect(await res.json()).toEqual({
      walletAddress: "0x0000000000000000000000000000000000000002",
    });
    expect(res.headers.get("set-cookie")).toContain(WALLET_SESSION_COOKIE_NAME);
  });
});
