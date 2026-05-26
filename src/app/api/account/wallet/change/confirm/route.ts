import { NextResponse } from "next/server";
import {
  confirmWalletChange,
  isAccountError,
} from "@/lib/account";
import { isSiweAuthError } from "@/lib/auth/siwe";
import {
  applyWalletSessionCookie,
  createWalletSessionToken,
} from "@/lib/auth/walletSession";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

function readPayload(value: unknown): {
  requestId: unknown;
  message: unknown;
  signature: unknown;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { requestId: undefined, message: undefined, signature: undefined };
  }
  const record = value as {
    requestId?: unknown;
    message?: unknown;
    signature?: unknown;
  };
  return {
    requestId: record.requestId,
    message: record.message,
    signature: record.signature,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  let user: RequestUser;
  try {
    user = await getRequestUser(request);
  } catch (err) {
    console.error("POST /api/account/wallet/change/confirm failed", err);
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
    const result = await confirmWalletChange({
      userId: user.id,
      currentWalletAddress: user.walletAddress,
      ...readPayload(payload),
    });
    const response = visitorJson(user, { walletAddress: result.walletAddress });
    return applyWalletSessionCookie(
      response,
      createWalletSessionToken({
        userId: user.id,
        walletAddress: result.walletAddress,
      }),
    );
  } catch (err) {
    if (isSiweAuthError(err)) {
      return visitorJson(user, { error: err.code }, { status: 400 });
    }
    if (isAccountError(err)) {
      const status =
        err.code === "wallet_already_linked"
          ? 409
          : err.code === "wallet_change_not_found"
          ? 404
          : 400;
      return visitorJson(user, { error: err.code }, { status });
    }
    console.error("POST /api/account/wallet/change/confirm failed", err);
    return visitorJson(user, { error: "internal_error" }, { status: 500 });
  }
}
