import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  beginRecoveryWalletChallenge,
  isRecoveryError,
} from "@/lib/auth/recovery";
import { checkInMemoryRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const CHALLENGE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const CHALLENGE_RATE_LIMIT_MAX = 20;

function readToken(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { recoveryToken?: unknown }).recoveryToken;
}

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function tokenFingerprint(value: unknown): string {
  if (typeof value !== "string") return "missing";
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const recoveryToken = readToken(payload);
  const rateLimit = checkInMemoryRateLimit({
    key: `recovery-challenge:${clientIp(request)}:${tokenFingerprint(
      recoveryToken,
    )}`,
    limit: CHALLENGE_RATE_LIMIT_MAX,
    windowMs: CHALLENGE_RATE_LIMIT_WINDOW_MS,
  });
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "recovery_challenge_rate_limited" },
      { status: 429 },
    );
  }

  try {
    const result = await beginRecoveryWalletChallenge({
      recoveryToken,
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
