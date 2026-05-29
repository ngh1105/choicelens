import { NextResponse } from "next/server";
import {
  isEmailVerifyError,
  requestEmailVerifyOtp,
} from "@/lib/auth/emailVerify";
import { isOtpError } from "@/lib/auth/recoveryOtp";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let user: RequestUser;
  try {
    user = await getRequestUser(request);
  } catch (err) {
    console.error("POST /api/account/recovery-email/verify/request failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (user.authKind !== "wallet") {
    return visitorJson(
      user,
      { error: "wallet_session_required" },
      { status: 401 },
    );
  }

  try {
    const result = await requestEmailVerifyOtp({ userId: user.id });
    return visitorJson(user, result);
  } catch (err) {
    if (isOtpError(err)) {
      const status = err.code === "otp_rate_limited" ? 429 : 400;
      return visitorJson(user, { error: err.code }, { status });
    }
    if (isEmailVerifyError(err)) {
      const status =
        err.code === "recovery_email_missing"
          ? 400
          : err.code === "recovery_email_already_verified"
          ? 409
          : 502;
      return visitorJson(user, { error: err.code }, { status });
    }
    console.error("POST /api/account/recovery-email/verify/request failed", err);
    return visitorJson(user, { error: "internal_error" }, { status: 500 });
  }
}
