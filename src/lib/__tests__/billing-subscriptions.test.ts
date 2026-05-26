import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("../db", () => ({
  prisma: {
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import {
  clearUserSubscription,
  ensureStripeCustomer,
  syncCheckoutSession,
  syncUserSubscription,
} from "../billing/subscriptions";
import { prisma } from "../db";

function subscription(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    items: {
      data: [
        {
          price: { id: "price_plus" },
          current_period_end: 1_779_552_000,
        },
      ],
    },
    ...overrides,
  } as Stripe.Subscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_PLUS_PRICE_ID = "price_plus";
});

describe("billing subscription sync", () => {
  it("marks plus for active subscriptions on the configured Plus price", async () => {
    await syncUserSubscription(subscription());

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { stripeCustomerId: "cus_123" },
          { stripeSubscriptionId: "sub_123" },
        ],
      },
      data: {
        plan: "plus",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_plus",
        stripeSubscriptionStatus: "active",
        stripeCurrentPeriodEnd: new Date(1_779_552_000 * 1000),
      },
    });
  });

  it("marks free when the active subscription is not the Plus price", async () => {
    await syncUserSubscription(
      subscription({
        items: {
          data: [
            {
              price: { id: "price_other" },
              current_period_end: 1_779_552_000,
            },
          ],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan: "free" }),
      }),
    );
  });

  it("clears deleted subscriptions to free", async () => {
    await clearUserSubscription(subscription({ status: "canceled" }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { stripeCustomerId: "cus_123" },
            { stripeSubscriptionId: "sub_123" },
          ],
        },
        data: expect.objectContaining({
          plan: "free",
          stripeCustomerId: "cus_123",
          stripeSubscriptionStatus: "canceled",
        }),
      }),
    );
  });

  it("syncs subscriptions by metadata user id before checkout arrives", async () => {
    await syncUserSubscription(
      subscription({
        metadata: { userId: "user_1" },
      }),
    );

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { stripeCustomerId: "cus_123" },
          { id: "user_1" },
          { stripeSubscriptionId: "sub_123" },
        ],
      },
      data: expect.objectContaining({
        plan: "plus",
        stripeCustomerId: "cus_123",
      }),
    });
  });

  it("reuses existing Stripe customers before creating one", async () => {
    const customerId = await ensureStripeCustomer({
      userId: "user_1",
      stripeCustomerId: "cus_existing",
      walletAddress: "0xabc",
      createCustomer: vi.fn(),
    });

    expect(customerId).toBe("cus_existing");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("stores newly created Stripe customers", async () => {
    const customerId = await ensureStripeCustomer({
      userId: "user_1",
      stripeCustomerId: null,
      walletAddress: "0xabc",
      createCustomer: vi.fn().mockResolvedValue({ id: "cus_new" }),
    });

    expect(customerId).toBe("cus_new");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeCustomerId: "cus_new" },
    });
  });

  it("stores checkout customer and subscription ids on the user", async () => {
    await syncCheckoutSession({
      metadata: { userId: "user_1" },
      customer: "cus_checkout",
      subscription: "sub_checkout",
    } as unknown as Stripe.Checkout.Session);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        stripeCustomerId: "cus_checkout",
        stripeSubscriptionId: "sub_checkout",
      },
    });
  });

  it("treats trialing subscriptions on the Plus price as plus", async () => {
    await syncUserSubscription(subscription({ status: "trialing" }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plan: "plus",
          stripeSubscriptionStatus: "trialing",
        }),
      }),
    );
  });

  it("treats past_due subscriptions on the Plus price as free", async () => {
    await syncUserSubscription(subscription({ status: "past_due" }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plan: "free",
          stripeSubscriptionStatus: "past_due",
        }),
      }),
    );
  });

  it("treats unpaid subscriptions on the Plus price as free", async () => {
    await syncUserSubscription(subscription({ status: "unpaid" }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan: "free" }),
      }),
    );
  });

  it("treats incomplete subscriptions on the Plus price as free", async () => {
    await syncUserSubscription(subscription({ status: "incomplete" }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan: "free" }),
      }),
    );
  });

  it("clearUserSubscription preserves recognized FREE statuses on the row", async () => {
    await clearUserSubscription(subscription({ status: "incomplete_expired" }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plan: "free",
          stripeSubscriptionStatus: "incomplete_expired",
        }),
      }),
    );
  });

  it("clearUserSubscription falls back to canceled for non-FREE statuses", async () => {
    await clearUserSubscription(subscription({ status: "active" }));

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plan: "free",
          stripeSubscriptionStatus: "canceled",
        }),
      }),
    );
  });

  it("syncCheckoutSession is a no-op when metadata.userId is missing", async () => {
    await syncCheckoutSession({
      customer: "cus_checkout",
      subscription: "sub_checkout",
    } as unknown as Stripe.Checkout.Session);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("syncCheckoutSession is a no-op when customer is missing", async () => {
    await syncCheckoutSession({
      metadata: { userId: "user_1" },
      subscription: "sub_checkout",
    } as unknown as Stripe.Checkout.Session);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("syncCheckoutSession unwraps a Stripe.Customer object", async () => {
    await syncCheckoutSession({
      metadata: { userId: "user_1" },
      customer: { id: "cus_checkout" } as Stripe.Customer,
      subscription: { id: "sub_checkout" } as Stripe.Subscription,
    } as unknown as Stripe.Checkout.Session);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        stripeCustomerId: "cus_checkout",
        stripeSubscriptionId: "sub_checkout",
      },
    });
  });
});
