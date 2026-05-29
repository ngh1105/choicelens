import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { getAppBaseUrl, getStripe } from "@/lib/billing/stripe";
import { isBillingEnabled } from "@/lib/billing/flag";
import { visitorJson } from "@/lib/visitor";
import { applyApiRateLimit, rateLimitedResponse } from "@/lib/apiRateLimit";
import { getRequestId, logRequestError } from "@/lib/requestLog";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  if (!isBillingEnabled()) {
    return NextResponse.json(
      { error: "billing_disabled", requestId },
      { status: 503 },
    );
  }
  let requestUser;
  try {
    requestUser = await getRequestUser(request);
  } catch (err) {
    logRequestError(requestId, "POST /api/billing/portal failed", err);
    return NextResponse.json(
      { error: "internal_error", requestId },
      { status: 500 },
    );
  }

  if (requestUser.authKind !== "wallet") {
    return visitorJson(
      requestUser,
      { error: "wallet_session_required", requestId },
      { status: 401 },
    );
  }

  const limit = await applyApiRateLimit(request, {
    scope: "billing:portal",
    limit: 10,
    windowMs: 60 * 60 * 1000,
    identifier: requestUser.id,
  });
  if (limit.limited) {
    return rateLimitedResponse({ result: limit, requestId });
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: requestUser.id },
      select: { stripeCustomerId: true },
    });
    if (!user.stripeCustomerId) {
      return visitorJson(
        requestUser,
        { error: "billing_portal_unavailable", requestId },
        { status: 409 },
      );
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${getAppBaseUrl()}/account`,
    });
    return visitorJson(requestUser, { url: session.url, requestId });
  } catch (err) {
    logRequestError(requestId, "POST /api/billing/portal failed", err, {
      userId: requestUser.id,
    });
    return visitorJson(
      requestUser,
      { error: "billing_portal_unavailable", requestId },
      { status: 500 },
    );
  }
}
