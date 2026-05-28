import { NextResponse } from "next/server";
import { confirmRecovery, isRecoveryError } from "@/lib/auth/recovery";
import { isSiweAuthError } from "@/lib/auth/siwe";
import {
  applyWalletSessionCookie,
  createWalletSessionToken,
} from "@/lib/auth/walletSession";
import { VISITOR_COOKIE_NAME } from "@/lib/visitor";
import { trackServerEvent } from "@/lib/analytics";

export const dynamic = "force-dynamic";

interface ConfirmPayload {
  recoveryToken?: unknown;
  message?: unknown;
  signature?: unknown;
}

function readPayload(value: unknown): ConfirmPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as ConfirmPayload;
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { recoveryToken, message, signature } = readPayload(payload);

  try {
    const result = await confirmRecovery({ recoveryToken, message, signature });

    const response = NextResponse.json({
      walletAddress: result.walletAddress,
      recoveryLockedUntil: result.recoveryLockedUntil,
    });

    applyWalletSessionCookie(
      response,
      createWalletSessionToken({
        userId: result.userId,
        walletAddress: result.walletAddress,
      }),
    );

    // Drop the visitor cookie. The visitor user record on this device is
    // intentionally left dangling (no merge); a separate cleanup job can
    // collect zero-activity visitors later.
    response.cookies.set({
      name: VISITOR_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    trackServerEvent("recovery_completed", { userId: result.userId });
    return response;
  } catch (err) {
    if (isSiweAuthError(err)) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    if (isRecoveryError(err)) {
      const status =
        err.code === "wallet_already_linked"
          ? 409
          : err.code === "recovery_locked"
          ? 423
          : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("POST /api/auth/recovery/confirm failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
