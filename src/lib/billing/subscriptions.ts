import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getStripePlusPriceId } from "@/lib/billing/stripe";

const PLUS_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
]);

const FREE_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "incomplete_expired",
  "past_due",
  "unpaid",
]);

function asUnixDate(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

function getCurrentPeriodEnd(subscription: Stripe.Subscription): number | null {
  return subscription.items.data[0]?.current_period_end ?? null;
}

function getSubscriptionPriceId(subscription: Stripe.Subscription): string | null {
  return subscription.items.data[0]?.price.id ?? null;
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function getSubscriptionId(subscription: string | Stripe.Subscription | null): string | null {
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

function resolvePlan(subscription: Stripe.Subscription): "free" | "plus" {
  const priceId = getSubscriptionPriceId(subscription);
  if (priceId !== getStripePlusPriceId()) return "free";
  return PLUS_STATUSES.has(subscription.status) ? "plus" : "free";
}

function subscriptionUserWhere(subscription: Stripe.Subscription) {
  const customerId = getCustomerId(subscription.customer);
  const userId = subscription.metadata?.userId;
  const clauses = [
    customerId ? { stripeCustomerId: customerId } : null,
    userId ? { id: userId } : null,
    { stripeSubscriptionId: subscription.id },
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);

  return clauses.length > 0 ? { OR: clauses } : null;
}

export async function syncUserSubscription(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = getCustomerId(subscription.customer);
  const where = subscriptionUserWhere(subscription);
  if (!where) return;

  await prisma.user.updateMany({
    where,
    data: {
      plan: resolvePlan(subscription),
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscription.id,
      stripePriceId: getSubscriptionPriceId(subscription),
      stripeSubscriptionStatus: subscription.status,
      stripeCurrentPeriodEnd: asUnixDate(getCurrentPeriodEnd(subscription)),
    },
  });
}

export async function syncCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = session.metadata?.userId;
  const customerId = getCustomerId(session.customer);
  const subscriptionId = getSubscriptionId(session.subscription);
  if (!userId || !customerId) return;

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    },
  });
}

export async function clearUserSubscription(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = getCustomerId(subscription.customer);
  const where = subscriptionUserWhere(subscription);
  if (!where) return;

  await prisma.user.updateMany({
    where,
    data: {
      plan: "free",
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscription.id,
      stripePriceId: getSubscriptionPriceId(subscription),
      stripeSubscriptionStatus: FREE_STATUSES.has(subscription.status)
        ? subscription.status
        : "canceled",
      stripeCurrentPeriodEnd: asUnixDate(getCurrentPeriodEnd(subscription)),
    },
  });
}

export async function ensureStripeCustomer(args: {
  userId: string;
  stripeCustomerId: string | null;
  walletAddress: string | null;
  createCustomer: () => Promise<Stripe.Customer>;
}): Promise<string> {
  if (args.stripeCustomerId) return args.stripeCustomerId;

  const customer = await args.createCustomer();
  await prisma.user.update({
    where: { id: args.userId },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}
