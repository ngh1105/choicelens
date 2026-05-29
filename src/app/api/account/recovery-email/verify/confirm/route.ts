import { NextResponse } from "next/server";
import {
  confirmEmailVerifyOtp,
  isEmailVerifyError,
} from "@/lib/auth/emailVerify";
import { isOtpError } from "@/lib/auth/recoveryOtp";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

function readCode(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { code?: unknown }).code;
}

export async function POST(request: Request): Promise<NextResponse> {
  let user: RequestUser;
  try {
    user = await getRequestUser(request);
  } catch (err) {
    console.error("POST /api/account/recovery-email/verify/confirm failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (user.authKind !== "wallet") {
    return visitorJson(
      user,
      { error: "wallet_session_required" },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return visitorJson(user, { error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await confirmEmailVerifyOtp({
      userId: user.id,
      code: readCode(payload),
    });
    return visitorJson(user, result);
  } catch (err) {
    if (isOtpError(err)) {
      return visitorJson(user, { error: err.code }, { status: 400 });
    }
    if (isEmailVerifyError(err)) {
      const status =
        err.code === "recovery_email_already_verified" ? 409 : 400;
      return visitorJson(user, { error: err.code }, { status });
    }
    console.error("POST /api/account/recovery-email/verify/confirm failed", err);
    return visitorJson(user, { error: "internal_error" }, { status: 500 });
  }
}
