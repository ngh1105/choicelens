import { NextResponse } from "next/server";
import {
  isRecoveryError,
  verifyRecoveryOtp,
} from "@/lib/auth/recovery";
import { isOtpError } from "@/lib/auth/recoveryOtp";

export const dynamic = "force-dynamic";

function readPayload(value: unknown): { email: unknown; code: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { email: undefined, code: undefined };
  }
  const record = value as { email?: unknown; code?: unknown };
  return { email: record.email, code: record.code };
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const { email, code } = readPayload(payload);
    const result = await verifyRecoveryOtp({ email, code });
    return NextResponse.json(result);
  } catch (err) {
    if (isOtpError(err)) {
      const status = err.code === "otp_rate_limited" ? 429 : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    if (isRecoveryError(err)) {
      const status = err.code === "recovery_locked" ? 423 : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("POST /api/auth/recovery/verify failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
