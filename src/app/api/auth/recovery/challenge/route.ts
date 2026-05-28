import { NextResponse } from "next/server";
import {
  beginRecoveryWalletChallenge,
  isRecoveryError,
} from "@/lib/auth/recovery";

export const dynamic = "force-dynamic";

function readToken(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { recoveryToken?: unknown }).recoveryToken;
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await beginRecoveryWalletChallenge({
      recoveryToken: readToken(payload),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (isRecoveryError(err)) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    console.error("POST /api/auth/recovery/challenge failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
