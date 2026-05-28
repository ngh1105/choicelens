import { NextResponse } from "next/server";
import { isRecoveryError, requestRecoveryOtp } from "@/lib/auth/recovery";

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
    // Always 204: do not leak whether the email is registered or rate-limited.
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isRecoveryError(err) && err.code === "recovery_email_send_failed") {
      // Provider-side failure: surface a 502 so the UI can prompt a retry.
      return NextResponse.json(
        { error: "recovery_email_send_failed" },
        { status: 502 },
      );
    }
    console.error("POST /api/auth/recovery/request failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
