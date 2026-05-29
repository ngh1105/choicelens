import { NextResponse } from "next/server";
import { trackServerEvent } from "@/lib/analytics";
import { requestRecoveryOtp } from "@/lib/auth/recovery";
import { applyApiRateLimit, rateLimitedResponse } from "@/lib/apiRateLimit";
import { getRequestId, logRequestError } from "@/lib/requestLog";

export const dynamic = "force-dynamic";

function readEmail(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { email?: unknown }).email;
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);

  // Per-IP throttle. We key on IP only (not email) so the limiter can't be
  // used as an email-existence oracle, and it bounds OTP-send burst abuse on
  // top of the DB-layer attempt limits.
  const limit = await applyApiRateLimit(request, {
    scope: "auth:recovery:request",
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (limit.limited) {
    return rateLimitedResponse({ result: limit, requestId });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", requestId }, { status: 400 });
  }

  try {
    await requestRecoveryOtp({ email: readEmail(payload) });
    trackServerEvent("recovery_started");
  } catch (err) {
    // recovery layer is meant to be silent; an exception here is a real bug
    // (DB error, programming mistake). Log it but keep the response generic
    // so we still don't leak email-existence to probes.
    logRequestError(requestId, "POST /api/auth/recovery/request failed", err);
  }
  return new NextResponse(null, { status: 204 });
}
