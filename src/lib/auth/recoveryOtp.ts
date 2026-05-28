import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/lib/db";

export const RECOVERY_OTP_PURPOSE = "wallet_recovery";
export const EMAIL_VERIFY_OTP_PURPOSE = "email_verify";
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const OTP_RATE_LIMIT_MAX = 5;

export type OtpPurpose =
  | typeof RECOVERY_OTP_PURPOSE
  | typeof EMAIL_VERIFY_OTP_PURPOSE;

export class OtpError extends Error {
  code:
    | "otp_invalid_or_expired"
    | "otp_rate_limited"
    | "otp_locked";

  constructor(code: OtpError["code"], message: string) {
    super(message);
    this.name = "OtpError";
    this.code = code;
  }
}

export function isOtpError(value: unknown): value is OtpError {
  return value instanceof OtpError;
}

export function generateOtpCode(): string {
  // 6 digits, leading-zero preserved.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

interface IssueOtpArgs {
  email: string;
  userId: string;
  purpose: OtpPurpose;
}

interface IssuedOtp {
  id: string;
  code: string;
  expiresAt: Date;
}

export async function issueOtp(args: IssueOtpArgs): Promise<IssuedOtp> {
  const since = new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_MS);
  const recentCount = await prisma.emailOtp.count({
    where: {
      email: args.email,
      purpose: args.purpose,
      createdAt: { gte: since },
    },
  });
  if (recentCount >= OTP_RATE_LIMIT_MAX) {
    throw new OtpError(
      "otp_rate_limited",
      "Too many OTP requests for this email.",
    );
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const record = await prisma.emailOtp.create({
    data: {
      email: args.email,
      userId: args.userId,
      purpose: args.purpose,
      codeHash: hashOtpCode(code),
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
  return { id: record.id, code, expiresAt: record.expiresAt };
}

interface ConsumeOtpArgs {
  email: string;
  purpose: OtpPurpose;
  code: string;
}

export interface ConsumedOtp {
  id: string;
  userId: string;
  email: string;
}

/**
 * Validates a submitted OTP against the latest active record for
 * (email, purpose). On success the record is consumed atomically.
 *
 * On failure we increment `attempts`. After OTP_MAX_ATTEMPTS misses the row
 * is invalidated so the user must request a fresh code.
 */
export async function consumeOtp(args: ConsumeOtpArgs): Promise<ConsumedOtp> {
  const now = new Date();
  const candidate = await prisma.emailOtp.findFirst({
    where: {
      email: args.email,
      purpose: args.purpose,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      email: true,
      codeHash: true,
      attempts: true,
    },
  });
  if (!candidate) {
    throw new OtpError(
      "otp_invalid_or_expired",
      "OTP is invalid or has expired.",
    );
  }

  const expectedHash = hashOtpCode(args.code);
  const ok = timingSafeEqualHex(expectedHash, candidate.codeHash);

  if (!ok) {
    const nextAttempts = candidate.attempts + 1;
    if (nextAttempts >= OTP_MAX_ATTEMPTS) {
      await prisma.emailOtp.update({
        where: { id: candidate.id },
        data: { attempts: nextAttempts, consumedAt: now },
      });
    } else {
      await prisma.emailOtp.update({
        where: { id: candidate.id },
        data: { attempts: nextAttempts },
      });
    }
    throw new OtpError(
      "otp_invalid_or_expired",
      "OTP is invalid or has expired.",
    );
  }

  // Atomic consume: only succeeds when the row is still pending.
  const updated = await prisma.emailOtp.updateMany({
    where: { id: candidate.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (updated.count !== 1) {
    throw new OtpError(
      "otp_invalid_or_expired",
      "OTP was already consumed.",
    );
  }

  return { id: candidate.id, userId: candidate.userId, email: candidate.email };
}
