import { NextResponse } from "next/server";
import { getAccountSummary, isAccountError } from "@/lib/account";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  let user: RequestUser;
  try {
    user = await getRequestUser(request);
  } catch (err) {
    console.error("GET /api/account failed", err);
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
    const summary = await getAccountSummary(user.id);
    return visitorJson(user, summary);
  } catch (err) {
    if (isAccountError(err) && err.code === "account_not_found") {
      return visitorJson(user, { error: "not_found" }, { status: 404 });
    }
    console.error("GET /api/account failed", err);
    return visitorJson(user, { error: "internal_error" }, { status: 500 });
  }
}
