import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-user";
import { prisma } from "@/lib/db";
import {
  getAppBaseUrl,
  getStripe,
  getStripePlusPriceId,
} from "@/lib/billing/stripe";
import { isBillingEnabled } from "@/lib/billing/flag";
import { ensureStripeCustomer } from "@/lib/billing/subscriptions";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "billing_disabled" }, { status: 503 });
  }
  let requestUser;
  try {
    requestUser = await getRequestUser(request);
  } catch (err) {
    console.error("POST /api/billing/checkout failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (requestUser.authKind !== "wallet") {
    return visitorJson(
      requestUser,
      { error: "wallet_session_required" },
      { status: 401 },
    );
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: requestUser.id },
      select: {
        id: true,
        primaryWalletAddress: true,
        stripeCustomerId: true,
      },
    });
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer({
      userId: user.id,
      stripeCustomerId: user.stripeCustomerId,
      walletAddress: user.primaryWalletAddress,
      createCustomer: () =>
        stripe.customers.create({
          metadata: {
            userId: user.id,
            walletAddress: user.primaryWalletAddress ?? "",
          },
        }),
    });
    const baseUrl = getAppBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getStripePlusPriceId(), quantity: 1 }],
      success_url: `${baseUrl}/account?billing=success`,
      cancel_url: `${baseUrl}/pricing?billing=cancelled`,
      metadata: { userId: user.id },
      subscription_data: {
        metadata: { userId: user.id },
      },
    });

    return visitorJson(requestUser, { url: session.url });
  } catch (err) {
    console.error("POST /api/billing/checkout failed", err);
    return visitorJson(
      requestUser,
      { error: "checkout_unavailable" },
      { status: 500 },
    );
  }
}
