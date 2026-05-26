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
import { getAccountSummary } from "@/lib/account";
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
});
