import { NextResponse } from "next/server";
import {
  applyApiRateLimit,
  rateLimitedResponse,
} from "@/lib/apiRateLimit";
import { createSiweNonce } from "@/lib/auth/siwe";
import { getOrCreateVisitorUser, visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const limit = await applyApiRateLimit(request, {
    scope: "siwe:nonce",
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (limit.limited) {
    return rateLimitedResponse({ result: limit });
  }
  try {
    const visitor = await getOrCreateVisitorUser(request);
    const nonce = await createSiweNonce(visitor.id);
    return visitorJson(visitor, { nonce });
  } catch (err) {
    console.error("POST /api/auth/siwe/nonce failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
