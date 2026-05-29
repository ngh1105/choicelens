import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("../db", () => ({
  prisma: {
    user: {
      upsert: vi.fn(),
    },
  },
}));

import {
  applyVisitorCookie,
  getOrCreateVisitorUser,
  isValidVisitorId,
  VISITOR_COOKIE_NAME,
} from "../visitor";
import { prisma } from "../db";

const validVisitorId = "v_existingvisitor123";
const userRecord = {
  id: "user_visitor",
  handle: "visitor:v_existingvisitor123",
  plan: "free",
  primaryWalletAddress: null,
  walletLinkedAt: null,
  recoveryEmail: null,
  recoveryEmailVerifiedAt: null,
  recoveryLockedUntil: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  stripeSubscriptionStatus: null,
  stripeCurrentPeriodEnd: null,
  createdAt: new Date("2026-05-22T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.upsert).mockResolvedValue(userRecord);
});

describe("visitor identity", () => {
  it("validates only opaque visitor ids", () => {
    expect(isValidVisitorId(validVisitorId)).toBe(true);
    expect(isValidVisitorId("anon")).toBe(false);
    expect(isValidVisitorId("visitor:v_existingvisitor123")).toBe(false);
    expect(isValidVisitorId("v_BAD")).toBe(false);
  });

  it("creates a visitor user and sets a cookie when missing", async () => {
    const visitor = await getOrCreateVisitorUser(new Request("http://test/"));
    const response = applyVisitorCookie(NextResponse.json({ ok: true }), visitor);

    expect(visitor.shouldSetCookie).toBe(true);
    expect(visitor.visitorId).toMatch(/^v_[a-z0-9_-]+$/);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { handle: `visitor:${visitor.visitorId}` },
      update: {},
      create: { handle: `visitor:${visitor.visitorId}` },
      select: { id: true, plan: true },
    });
    expect(response.headers.get("set-cookie")).toContain(VISITOR_COOKIE_NAME);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("reuses a valid visitor cookie without rotating", async () => {
    const visitor = await getOrCreateVisitorUser(
      new Request("http://test/", {
        headers: { cookie: `${VISITOR_COOKIE_NAME}=${validVisitorId}` },
      }),
    );
    const response = applyVisitorCookie(NextResponse.json({ ok: true }), visitor);

    expect(visitor).toMatchObject({
      id: "user_visitor",
      plan: "free",
      visitorId: validVisitorId,
      shouldSetCookie: false,
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { handle: `visitor:${validVisitorId}` },
      }),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rotates invalid visitor cookies", async () => {
    const visitor = await getOrCreateVisitorUser(
      new Request("http://test/", {
        headers: { cookie: `${VISITOR_COOKIE_NAME}=visitor:bad` },
      }),
    );

    expect(visitor.shouldSetCookie).toBe(true);
    expect(visitor.visitorId).not.toBe("visitor:bad");
    expect(visitor.visitorId).toMatch(/^v_[a-z0-9_-]+$/);
  });
});
