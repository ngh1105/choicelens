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
    getAccountSummary: vi.fn(),
  };
});

import { GET } from "../route";
import { AccountError, getAccountSummary } from "@/lib/account";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestUser).mockResolvedValue(walletUser);
  vi.mocked(getAccountSummary).mockResolvedValue({
    plan: "plus",
    effectivePlan: "plus",
    primaryWalletAddress: walletUser.walletAddress,
    recoveryEmail: "name@example.com",
    recoveryEmailVerifiedAt: null,
    stripeCustomerId: "cus_123",
    stripeSubscriptionStatus: "active",
    stripeCurrentPeriodEnd: "2026-06-01T00:00:00.000Z",
  });
});

describe("GET /api/account", () => {
  it("requires wallet session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(visitorUser);

    const res = await GET(new Request("http://test/api/account"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wallet_session_required" });
    expect(getAccountSummary).not.toHaveBeenCalled();
  });

  it("returns account summary for wallet sessions", async () => {
    const res = await GET(new Request("http://test/api/account"));

    expect(res.status).toBe(200);
    expect(getAccountSummary).toHaveBeenCalledWith("user_1");
    expect(await res.json()).toMatchObject({
      plan: "plus",
      primaryWalletAddress: walletUser.walletAddress,
    });
  });

  it("returns 500 internal_error when getRequestUser throws", async () => {
    vi.mocked(getRequestUser).mockRejectedValueOnce(new Error("db down"));

    const res = await GET(new Request("http://test/api/account"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(getAccountSummary).not.toHaveBeenCalled();
  });

  it("maps account_not_found to 404", async () => {
    vi.mocked(getAccountSummary).mockRejectedValueOnce(
      new AccountError("account_not_found", "User not found."),
    );

    const res = await GET(new Request("http://test/api/account"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 500 internal_error for unexpected getAccountSummary failures", async () => {
    vi.mocked(getAccountSummary).mockRejectedValueOnce(new Error("boom"));

    const res = await GET(new Request("http://test/api/account"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});
