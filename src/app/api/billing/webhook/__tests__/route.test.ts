import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  syncCheckoutSession: vi.fn(),
  syncUserSubscription: vi.fn(),
  clearUserSubscription: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/stripe")>(
    "@/lib/billing/stripe",
  );
  return {
    ...actual,
    getStripe: () => ({
      webhooks: { constructEvent: mocks.constructEvent },
    }),
  };
});

vi.mock("@/lib/billing/subscriptions", () => ({
  syncCheckoutSession: mocks.syncCheckoutSession,
  syncUserSubscription: mocks.syncUserSubscription,
  clearUserSubscription: mocks.clearUserSubscription,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    stripeWebhookEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { POST } from "../route";
import { prisma } from "@/lib/db";

function request(body = "{}"): Request {
  return new Request("http://test/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig_123" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
  mocks.constructEvent.mockReturnValue({
    id: "evt_123",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_123" } },
  });
  vi.mocked(prisma.stripeWebhookEvent.create).mockResolvedValue({} as never);
  vi.mocked(prisma.stripeWebhookEvent.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.stripeWebhookEvent.update).mockResolvedValue({} as never);
});

describe("POST /api/billing/webhook", () => {
  it("uses raw request text for signature verification", async () => {
    await POST(request('{"id":"evt_123"}'));

    expect(mocks.constructEvent).toHaveBeenCalledWith(
      '{"id":"evt_123"}',
      "sig_123",
      "whsec_123",
    );
  });

  it("stores event id before processing and marks processed", async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(prisma.stripeWebhookEvent.create).toHaveBeenCalledWith({
      data: {
        id: "evt_123",
        type: "customer.subscription.updated",
        status: "processing",
      },
    });
    expect(mocks.syncUserSubscription).toHaveBeenCalledWith({ id: "sub_123" });
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: "evt_123" },
      data: {
        status: "processed",
        processedAt: expect.any(Date),
        errorMessage: null,
      },
    });
  });

  it("skips duplicate webhook events idempotently", async () => {
    vi.mocked(prisma.stripeWebhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    vi.mocked(prisma.stripeWebhookEvent.findUnique).mockResolvedValue({
      status: "processed",
      receivedAt: new Date("2026-05-23T00:00:00.000Z"),
    } as never);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.syncUserSubscription).not.toHaveBeenCalled();
  });

  it("retries failed webhook events instead of treating them as duplicates", async () => {
    vi.mocked(prisma.stripeWebhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    vi.mocked(prisma.stripeWebhookEvent.findUnique).mockResolvedValue({
      status: "failed",
      receivedAt: new Date("2026-05-23T00:00:00.000Z"),
    } as never);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.syncUserSubscription).toHaveBeenCalledWith({ id: "sub_123" });
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: "evt_123" },
      data: {
        type: "customer.subscription.updated",
        status: "processing",
        errorMessage: null,
      },
    });
  });

  it("marks deleted subscriptions free", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_deleted" } },
    });

    await POST(request());

    expect(mocks.clearUserSubscription).toHaveBeenCalledWith({ id: "sub_deleted" });
  });

  it("syncs checkout sessions before subscription webhooks arrive", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_checkout",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123" } },
    });

    await POST(request());

    expect(mocks.syncCheckoutSession).toHaveBeenCalledWith({ id: "cs_123" });
  });

  it("rejects invalid signatures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const res = await POST(request());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(prisma.stripeWebhookEvent.create).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rejects requests missing the stripe-signature header", async () => {
    const res = await POST(
      new Request("http://test/api/billing/webhook", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_signature" });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(prisma.stripeWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("treats stale processing reservations as retryable and resets receivedAt", async () => {
    vi.mocked(prisma.stripeWebhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const stale = new Date(Date.now() - 6 * 60 * 1000);
    vi.mocked(prisma.stripeWebhookEvent.findUnique).mockResolvedValue({
      status: "processing",
      receivedAt: stale,
    } as never);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.syncUserSubscription).toHaveBeenCalled();
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: "evt_123" },
      data: {
        type: "customer.subscription.updated",
        status: "processing",
        errorMessage: null,
      },
    });
  });

  it("treats fresh processing reservations as duplicates", async () => {
    vi.mocked(prisma.stripeWebhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    vi.mocked(prisma.stripeWebhookEvent.findUnique).mockResolvedValue({
      status: "processing",
      receivedAt: new Date(),
    } as never);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.syncUserSubscription).not.toHaveBeenCalled();
  });

  it("treats missing reservation rows as duplicates", async () => {
    vi.mocked(prisma.stripeWebhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    vi.mocked(prisma.stripeWebhookEvent.findUnique).mockResolvedValue(null);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.syncUserSubscription).not.toHaveBeenCalled();
  });

  it("ignores unknown event types but still marks them processed", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_unknown",
      type: "invoice.paid",
      data: { object: {} },
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.syncUserSubscription).not.toHaveBeenCalled();
    expect(mocks.clearUserSubscription).not.toHaveBeenCalled();
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: "evt_unknown" },
      data: {
        status: "processed",
        processedAt: expect.any(Date),
        errorMessage: null,
      },
    });
  });

  it("marks failed and returns 500 when processing throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.syncUserSubscription.mockRejectedValueOnce(new Error("downstream"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: "evt_123" },
      data: {
        status: "failed",
        errorMessage: "downstream",
      },
    });
    errorSpy.mockRestore();
  });

  it("returns 500 when reserveWebhookEvent itself throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.stripeWebhookEvent.create).mockRejectedValueOnce(
      new Error("db down"),
    );

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(mocks.syncUserSubscription).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
