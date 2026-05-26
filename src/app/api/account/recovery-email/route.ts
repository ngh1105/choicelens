import { NextResponse } from "next/server";
import { isAccountError, updateRecoveryEmail } from "@/lib/account";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

function readRecoveryEmail(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { recoveryEmail?: unknown }).recoveryEmail;
}

export async function POST(request: Request): Promise<NextResponse> {
  let user: RequestUser;
  try {
    user = await getRequestUser(request);
  } catch (err) {
    console.error("POST /api/account/recovery-email failed", err);
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
    const recoveryEmail = await updateRecoveryEmail(
      user.id,
      readRecoveryEmail(payload),
    );
    return visitorJson(user, { recoveryEmail });
  } catch (err) {
    if (isAccountError(err)) {
      return visitorJson(user, { error: err.code }, { status: 400 });
    }
    console.error("POST /api/account/recovery-email failed", err);
    return visitorJson(user, { error: "internal_error" }, { status: 500 });
  }
}
