import { beforeEach, describe, expect, it, vi } from "vitest";

const portalCreate = vi.fn();

vi.mock("@/lib/request-user", () => ({
  getRequestUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock("@/lib/billing/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/stripe")>(
    "@/lib/billing/stripe",
  );
  return {
    ...actual,
    getStripe: () => ({
      billingPortal: { sessions: { create: portalCreate } },
    }),
  };
});

import { POST } from "../route";
import { getRequestUser } from "@/lib/request-user";
import { prisma } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_BASE_URL = "https://choice.test";
  vi.mocked(getRequestUser).mockResolvedValue({
    id: "user_1",
    plan: "plus",
    visitorId: "v_1",
    shouldSetCookie: false,
    authKind: "wallet",
    walletAddress: "0xabc",
  });
  vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
    stripeCustomerId: "cus_123",
  } as never);
  portalCreate.mockResolvedValue({ url: "https://stripe.test/portal" });
});

describe("POST /api/billing/portal", () => {
  it("requires wallet auth", async () => {
    vi.mocked(getRequestUser).mockResolvedValue({
      id: "visitor_1",
      plan: "free",
      visitorId: "v_1",
      shouldSetCookie: false,
      authKind: "visitor",
      walletAddress: null,
    });

    const res = await POST(new Request("http://test/api/billing/portal"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wallet_session_required" });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("requires an existing Stripe customer", async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      stripeCustomerId: null,
    } as never);

    const res = await POST(new Request("http://test/api/billing/portal"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "billing_portal_unavailable" });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("creates a billing portal session", async () => {
    const res = await POST(new Request("http://test/api/billing/portal"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://stripe.test/portal" });
    expect(portalCreate).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://choice.test/account",
    });
  });
});
