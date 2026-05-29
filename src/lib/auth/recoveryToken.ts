import { createHmac, timingSafeEqual } from "node:crypto";

export const RECOVERY_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface RecoveryTokenPayload {
  userId: string;
  email: string;
  otpId: string;
  issuedAt: number;
  expiresAt: number;
}

interface CreateArgs {
  userId: string;
  email: string;
  otpId: string;
  now?: Date;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function fromBase64url(input: string): Buffer {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return Buffer.from(padded, "base64");
}

let warnedAboutRecoveryFallback = false;

function warnRecoveryFallback(reason: string): void {
  if (warnedAboutRecoveryFallback) return;
  warnedAboutRecoveryFallback = true;
  console.warn(
    `[security] ${reason}; using insecure dev fallback for recovery tokens. Recovery tokens are forgeable in this environment.`,
  );
}

function getSecret(): string {
  const secret = process.env.WALLET_RECOVERY_TOKEN_SECRET?.trim();
  if (secret) return `choicelens-wallet-recovery-v1:${secret}`;

  const sessionSecret = process.env.WALLET_SESSION_SECRET?.trim();
  if (sessionSecret) {
    return `choicelens-wallet-recovery-v1:${sessionSecret}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "WALLET_RECOVERY_TOKEN_SECRET or WALLET_SESSION_SECRET is required in production for recovery tokens.",
    );
  }
  warnRecoveryFallback(
    "WALLET_RECOVERY_TOKEN_SECRET and WALLET_SESSION_SECRET not set",
  );
  return "choicelens-wallet-recovery-v1:dev-wallet-session-secret";
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", getSecret()).update(payload).digest());
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isPayload(value: unknown): value is RecoveryTokenPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "string" &&
    typeof record.email === "string" &&
    typeof record.otpId === "string" &&
    typeof record.issuedAt === "number" &&
    typeof record.expiresAt === "number"
  );
}

export function createRecoveryToken(args: CreateArgs): string {
  const issuedAt = Math.floor((args.now ?? new Date()).getTime() / 1000);
  const payload: RecoveryTokenPayload = {
    userId: args.userId,
    email: args.email,
    otpId: args.otpId,
    issuedAt,
    expiresAt: issuedAt + Math.floor(RECOVERY_TOKEN_TTL_MS / 1000),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function parseRecoveryToken(
  value: string | null | undefined,
  now = new Date(),
): RecoveryTokenPayload | null {
  if (!value) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, sign(encoded))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64url(encoded).toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isPayload(parsed)) return null;
  if (parsed.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
  return parsed;
}
