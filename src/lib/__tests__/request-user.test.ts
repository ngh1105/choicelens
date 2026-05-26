import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../visitor", () => ({
  getOrCreateVisitorUser: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

import { getRequestUser } from "../request-user";
import {
  createWalletSessionToken,
  WALLET_SESSION_COOKIE_NAME,
} from "../auth/walletSession";
import { prisma } from "../db";
import { getOrCreateVisitorUser } from "../visitor";

const visitor = {
  id: "visitor_user",
  plan: "free",
  visitorId: "v_testvisitor000000",
  shouldSetCookie: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrCreateVisitorUser).mockResolvedValue(visitor);
});

describe("getRequestUser", () => {
  it("returns visitor user when no wallet session exists", async () => {
    const user = await getRequestUser(new Request("http://test/"));

    expect(user).toEqual({
      ...visitor,
      authKind: "visitor",
      walletAddress: null,
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns wallet user when signed session matches a linked wallet", async () => {
    const token = createWalletSessionToken({
      userId: "wallet_user",
      walletAddress: "0x0000000000000000000000000000000000000001",
      now: new Date("2026-05-23T00:00:00.000Z"),
    });
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "wallet_user",
      plan: "plus",
      primaryWalletAddress: "0x0000000000000000000000000000000000000001",
    } as never);

    const user = await getRequestUser(
      new Request("http://test/", {
        headers: { cookie: `${WALLET_SESSION_COOKIE_NAME}=${token}` },
      }),
    );

    expect(user).toEqual({
      id: "wallet_user",
      plan: "plus",
      visitorId: visitor.visitorId,
      shouldSetCookie: false,
      authKind: "wallet",
      walletAddress: "0x0000000000000000000000000000000000000001",
    });
  });

  it("falls back to visitor user when wallet session no longer matches", async () => {
    const token = createWalletSessionToken({
      userId: "wallet_user",
      walletAddress: "0x0000000000000000000000000000000000000001",
    });
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    const user = await getRequestUser(
      new Request("http://test/", {
        headers: { cookie: `${WALLET_SESSION_COOKIE_NAME}=${token}` },
      }),
    );

    expect(user.authKind).toBe("visitor");
    expect(user.id).toBe("visitor_user");
  });
});
