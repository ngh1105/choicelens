import { beforeEach, describe, expect, it, vi } from "vitest";

const checkoutCreate = vi.fn();
const customerCreate = vi.fn();

vi.mock("@/lib/request-user", () => ({
  getRequestUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
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
      checkout: { sessions: { create: checkoutCreate } },
      customers: { create: customerCreate },
    }),
  };
});

import { POST } from "../route";
import { getRequestUser } from "@/lib/request-user";
import { prisma } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_PLUS_PRICE_ID = "price_plus";
  process.env.APP_BASE_URL = "https://choice.test/";
  vi.mocked(getRequestUser).mockResolvedValue({
    id: "user_1",
    plan: "free",
    visitorId: "v_1",
    shouldSetCookie: false,
    authKind: "wallet",
    walletAddress: "0xabc",
  });
  vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
    id: "user_1",
    primaryWalletAddress: "0xabc",
    stripeCustomerId: "cus_existing",
  } as never);
  checkoutCreate.mockResolvedValue({ url: "https://stripe.test/checkout" });
});

describe("POST /api/billing/checkout", () => {
  it("requires wallet auth", async () => {
    vi.mocked(getRequestUser).mockResolvedValue({
      id: "visitor_1",
      plan: "free",
      visitorId: "v_1",
      shouldSetCookie: false,
      authKind: "visitor",
      walletAddress: null,
    });

    const res = await POST(new Request("http://test/api/billing/checkout"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wallet_session_required" });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("creates Plus checkout with the configured price and app redirects", async () => {
    const res = await POST(new Request("http://test/api/billing/checkout"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://stripe.test/checkout" });
    expect(checkoutCreate).toHaveBeenCalledWith({
      mode: "subscription",
      customer: "cus_existing",
      line_items: [{ price: "price_plus", quantity: 1 }],
      success_url: "https://choice.test/account?billing=success",
      cancel_url: "https://choice.test/pricing?billing=cancelled",
      metadata: { userId: "user_1" },
      subscription_data: {
        metadata: { userId: "user_1" },
      },
    });
  });

  it("creates and stores a Stripe customer when missing", async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: "user_1",
      primaryWalletAddress: "0xabc",
      stripeCustomerId: null,
    } as never);
    customerCreate.mockResolvedValue({ id: "cus_new" });

    await POST(new Request("http://test/api/billing/checkout"));

    expect(customerCreate).toHaveBeenCalledWith({
      metadata: {
        userId: "user_1",
        walletAddress: "0xabc",
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeCustomerId: "cus_new" },
    });
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new" }),
    );
  });
});
