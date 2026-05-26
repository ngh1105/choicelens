import { NextResponse } from "next/server";
import {
  createWalletChangeRequest,
  isAccountError,
} from "@/lib/account";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

function readRequestedWalletAddress(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { requestedWalletAddress?: unknown }).requestedWalletAddress;
}

export async function POST(request: Request): Promise<NextResponse> {
  let user: RequestUser;
  try {
    user = await getRequestUser(request);
  } catch (err) {
    console.error("POST /api/account/wallet/change failed", err);
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
    const walletChangeRequest = await createWalletChangeRequest({
      userId: user.id,
      currentWalletAddress: user.walletAddress,
      requestedWalletAddress: readRequestedWalletAddress(payload),
    });
    return visitorJson(user, { walletChangeRequest }, { status: 201 });
  } catch (err) {
    if (isAccountError(err)) {
      const status = err.code === "wallet_already_linked" ? 409 : 400;
      return visitorJson(user, { error: err.code }, { status });
    }
    console.error("POST /api/account/wallet/change failed", err);
    return visitorJson(user, { error: "internal_error" }, { status: 500 });
  }
}
