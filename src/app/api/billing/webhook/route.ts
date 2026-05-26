import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  getStripeWebhookSecret,
} from "@/lib/billing/stripe";
import {
  clearUserSubscription,
  syncCheckoutSession,
  syncUserSubscription,
} from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const WEBHOOK_PROCESSING_STALE_MS = 5 * 60 * 1000;

function isUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function isRetryableWebhookStatus(status: string, receivedAt: Date): boolean {
  if (status === "failed") return true;
  return (
    status === "processing" &&
    Date.now() - receivedAt.getTime() > WEBHOOK_PROCESSING_STALE_MS
  );
}

async function reserveWebhookEvent(
  event: Stripe.Event,
): Promise<"process" | "duplicate"> {
  try {
    await prisma.stripeWebhookEvent.create({
      data: {
        id: event.id,
        type: event.type,
        status: "processing",
      },
    });
    return "process";
  } catch (err) {
    if (!isUniqueConflict(err)) {
      throw err;
    }
  }

  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { id: event.id },
    select: { status: true, receivedAt: true },
  });
  if (!existing || !isRetryableWebhookStatus(existing.status, existing.receivedAt)) {
    return "duplicate";
  }

  await prisma.stripeWebhookEvent.update({
    where: { id: event.id },
    data: {
      type: event.type,
      status: "processing",
      errorMessage: null,
    },
  });
  return "process";
}

async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await syncCheckoutSession(event.data.object as Stripe.Checkout.Session);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncUserSubscription(event.data.object as Stripe.Subscription);
      return;
    case "customer.subscription.deleted":
      await clearUserSubscription(event.data.object as Stripe.Subscription);
      return;
    default:
      return;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      await request.text(),
      signature,
      getStripeWebhookSecret(),
    );
  } catch (err) {
    console.error("POST /api/billing/webhook signature failed", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    const reservation = await reserveWebhookEvent(event);
    if (reservation === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    console.error("POST /api/billing/webhook store failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  try {
    await processEvent(event);
    await prisma.stripeWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: "processed",
        processedAt: new Date(),
        errorMessage: null,
      },
    });
    return NextResponse.json({ received: true });
  } catch (err) {
    await prisma.stripeWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    console.error("POST /api/billing/webhook processing failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
