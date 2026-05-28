import { NextResponse } from "next/server";
import { requestRecoveryOtp } from "@/lib/auth/recovery";

export const dynamic = "force-dynamic";

function readEmail(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { email?: unknown }).email;
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    await requestRecoveryOtp({ email: readEmail(payload) });
  } catch (err) {
    // recovery layer is meant to be silent; an exception here is a real bug
    // (DB error, programming mistake). Log it but keep the response generic
    // so we still don't leak email-existence to probes.
    console.error("POST /api/auth/recovery/request failed", err);
  }
  return new NextResponse(null, { status: 204 });
}
