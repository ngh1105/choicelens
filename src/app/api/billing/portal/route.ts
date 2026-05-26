import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { getAppBaseUrl, getStripe } from "@/lib/billing/stripe";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let requestUser;
  try {
    requestUser = await getRequestUser(request);
  } catch (err) {
    console.error("POST /api/billing/portal failed", err);
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
      select: { stripeCustomerId: true },
    });
    if (!user.stripeCustomerId) {
      return visitorJson(
        requestUser,
        { error: "billing_portal_unavailable" },
        { status: 409 },
      );
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${getAppBaseUrl()}/account`,
    });
    return visitorJson(requestUser, { url: session.url });
  } catch (err) {
    console.error("POST /api/billing/portal failed", err);
    return visitorJson(
      requestUser,
      { error: "billing_portal_unavailable" },
      { status: 500 },
    );
  }
}
