import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  consumeOtp,
  isOtpError,
  issueOtp,
  OtpError,
  RECOVERY_OTP_PURPOSE,
} from "@/lib/auth/recoveryOtp";
import {
  createRecoveryToken,
  parseRecoveryToken,
  type RecoveryTokenPayload,
} from "@/lib/auth/recoveryToken";
import {
  isSiweAuthError,
  normalizeWalletAddress,
  SiweAuthError,
  verifySiweMessage,
} from "@/lib/auth/siwe";
import { createNonce } from "@/lib/auth/walletSession";
import { parseRecoveryEmail } from "@/lib/account";
import {
  isEmailEnabled,
  isEmailSendError,
  type EmailSendError,
} from "@/lib/email/resend";
import { sendRecoveryOtpEmail } from "@/lib/email/templates";

export const RECOVERY_LOCKOUT_MS = 24 * 60 * 60 * 1000;
export const RECOVERY_NONCE_TTL_MS = 10 * 60 * 1000;

export class RecoveryError extends Error {
  code:
    | "recovery_email_invalid"
    | "recovery_token_invalid"
    | "recovery_locked"
    | "recovery_email_send_failed"
    | "wallet_same_as_current"
    | "wallet_already_linked"
    | "wallet_invalid";

  constructor(code: RecoveryError["code"], message: string) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
  }
}

export function isRecoveryError(value: unknown): value is RecoveryError {
  return value instanceof RecoveryError;
}

interface RequestRecoveryOtpArgs {
  email: unknown;
}

export interface RequestRecoveryOtpResult {
  delivered: boolean;
}

/**
 * Requests a wallet-recovery OTP for the given email.
 *
 * The HTTP layer should always respond with a generic success regardless of
 * outcome to avoid leaking whether an email is registered. The `delivered`
 * flag here is for logging/metrics only.
 *
 * Cases that silently noop:
 *  - Invalid email format.
 *  - No user has this address as a verified recovery email.
 *  - User is currently inside their post-recovery cooldown window.
 *  - Rate limit hit for this (email, purpose) pair.
 *
 * Throws RecoveryError("recovery_email_send_failed") only when the email
 * provider is configured and rejected the message; the caller may choose to
 * surface that to the user or, more conservatively, swallow it.
 */
export async function requestRecoveryOtp(
  args: RequestRecoveryOtpArgs,
): Promise<RequestRecoveryOtpResult> {
  let email: string | null;
  try {
    email = parseRecoveryEmail(args.email);
  } catch {
    return { delivered: false };
  }
  if (!email) return { delivered: false };

  const user = await prisma.user.findFirst({
    where: {
      recoveryEmail: email,
      recoveryEmailVerifiedAt: { not: null },
    },
    select: {
      id: true,
      recoveryLockedUntil: true,
    },
  });
  if (!user) return { delivered: false };
  if (user.recoveryLockedUntil && user.recoveryLockedUntil > new Date()) {
    return { delivered: false };
  }

  let issued: { id: string; code: string; expiresAt: Date };
  try {
    issued = await issueOtp({
      email,
      userId: user.id,
      purpose: RECOVERY_OTP_PURPOSE,
    });
  } catch (err) {
    if (isOtpError(err) && err.code === "otp_rate_limited") {
      return { delivered: false };
    }
    throw err;
  }

  if (!isEmailEnabled()) {
    if (process.env.NODE_ENV !== "production") {
      // In dev/test we surface the code in logs so engineers can complete the
      // flow without configuring Resend.
      console.info(
        `[recovery] OTP for ${email}: ${issued.code} (expires ${issued.expiresAt.toISOString()})`,
      );
    }
    return { delivered: false };
  }

  try {
    await sendRecoveryOtpEmail({
      to: email,
      code: issued.code,
      expiresAt: issued.expiresAt,
    });
  } catch (err) {
    if (isEmailSendError(err)) {
      const sendErr = err as EmailSendError;
      console.error("recovery email failed", sendErr.code, sendErr.message);
      throw new RecoveryError(
        "recovery_email_send_failed",
        "Failed to send recovery email.",
      );
    }
    throw err;
  }
  return { delivered: true };
}

interface VerifyRecoveryOtpArgs {
  email: unknown;
  code: unknown;
}

export interface VerifyRecoveryOtpResult {
  recoveryToken: string;
  expiresAt: string;
}

export async function verifyRecoveryOtp(
  args: VerifyRecoveryOtpArgs,
): Promise<VerifyRecoveryOtpResult> {
  let email: string | null;
  try {
    email = parseRecoveryEmail(args.email);
  } catch {
    throw new OtpError(
      "otp_invalid_or_expired",
      "OTP is invalid or has expired.",
    );
  }
  if (!email || typeof args.code !== "string") {
    throw new OtpError(
      "otp_invalid_or_expired",
      "OTP is invalid or has expired.",
    );
  }
  const code = args.code.trim();
  if (!/^\d{6}$/.test(code)) {
    throw new OtpError(
      "otp_invalid_or_expired",
      "OTP is invalid or has expired.",
    );
  }

  const consumed = await consumeOtp({
    email,
    purpose: RECOVERY_OTP_PURPOSE,
    code,
  });

  // Re-check user is still eligible (not locked) at consume time.
  const user = await prisma.user.findUnique({
    where: { id: consumed.userId },
    select: { recoveryLockedUntil: true },
  });
  if (
    user?.recoveryLockedUntil &&
    user.recoveryLockedUntil > new Date()
  ) {
    throw new RecoveryError(
      "recovery_locked",
      "Recovery is temporarily locked for this account.",
    );
  }

  const token = createRecoveryToken({
    userId: consumed.userId,
    email: consumed.email,
    otpId: consumed.id,
  });
  const expiresAt = new Date(Date.now() + RECOVERY_NONCE_TTL_MS);
  return { recoveryToken: token, expiresAt: expiresAt.toISOString() };
}

interface BeginRecoveryWalletChallengeArgs {
  recoveryToken: unknown;
}

export interface RecoveryWalletChallenge {
  nonce: string;
  expiresAt: string;
}

/**
 * Issues a SIWE nonce bound to the recovery token. The new wallet must sign
 * a SIWE message including this nonce; the server records the challenge in
 * the same `WalletLinkRequest` table used by the wallet-change flow but with
 * a recovery-specific status so we can audit.
 */
export async function beginRecoveryWalletChallenge(
  args: BeginRecoveryWalletChallengeArgs,
): Promise<RecoveryWalletChallenge> {
  const token = parseTokenOrThrow(args.recoveryToken);
  const nonce = createNonce();
  const expiresAt = new Date(Date.now() + RECOVERY_NONCE_TTL_MS);
  await prisma.walletLinkRequest.create({
    data: {
      userId: token.userId,
      requestedWalletAddress: "0x0000000000000000000000000000000000000000",
      challengeNonce: nonce,
      status: "recovery_nonce",
      expiresAt,
    },
  });
  return { nonce, expiresAt: expiresAt.toISOString() };
}

interface ConfirmRecoveryArgs {
  recoveryToken: unknown;
  message: unknown;
  signature: unknown;
}

export interface ConfirmRecoveryResult {
  userId: string;
  walletAddress: string;
  recoveryLockedUntil: string;
}

export async function confirmRecovery(
  args: ConfirmRecoveryArgs,
): Promise<ConfirmRecoveryResult> {
  const token = parseTokenOrThrow(args.recoveryToken);
  if (typeof args.message !== "string" || typeof args.signature !== "string") {
    throw new RecoveryError(
      "recovery_token_invalid",
      "Recovery payload is invalid.",
    );
  }

  // Resolve the most recent unconsumed recovery_nonce for this user, scoped to
  // the recovery-token TTL window so a stale nonce can't be replayed.
  const nonceRecord = await prisma.walletLinkRequest.findFirst({
    where: {
      userId: token.userId,
      status: "recovery_nonce",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, challengeNonce: true },
  });
  if (!nonceRecord) {
    throw new RecoveryError(
      "recovery_token_invalid",
      "Recovery wallet challenge is missing or expired.",
    );
  }

  let walletAddress: string;
  try {
    const verified = await verifySiweMessage({
      message: args.message,
      signature: args.signature,
      nonce: nonceRecord.challengeNonce,
    });
    walletAddress = verified.walletAddress;
  } catch (err) {
    if (isSiweAuthError(err)) throw err;
    throw new SiweAuthError(
      "siwe_rejected",
      "Wallet signature could not be verified.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: token.userId },
    select: {
      id: true,
      primaryWalletAddress: true,
      recoveryLockedUntil: true,
    },
  });
  if (!user) {
    throw new RecoveryError(
      "recovery_token_invalid",
      "Account was not found.",
    );
  }
  if (
    user.primaryWalletAddress &&
    normalizeWalletAddress(user.primaryWalletAddress) === walletAddress
  ) {
    throw new RecoveryError(
      "wallet_same_as_current",
      "New wallet matches the current primary wallet.",
    );
  }
  if (user.recoveryLockedUntil && user.recoveryLockedUntil > new Date()) {
    throw new RecoveryError(
      "recovery_locked",
      "Recovery is temporarily locked for this account.",
    );
  }

  // Reject if the new wallet already belongs to a different account.
  const conflict = await prisma.user.findUnique({
    where: { primaryWalletAddress: walletAddress },
    select: { id: true },
  });
  if (conflict && conflict.id !== user.id) {
    throw new RecoveryError(
      "wallet_already_linked",
      "Wallet is already linked to another account.",
    );
  }

  const recoveryLockedUntil = new Date(Date.now() + RECOVERY_LOCKOUT_MS);
  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          primaryWalletAddress: walletAddress,
          walletLinkedAt: new Date(),
          recoveryLockedUntil,
        },
      }),
      prisma.walletLinkRequest.update({
        where: { id: nonceRecord.id },
        data: { status: "recovery_used", confirmedAt: new Date() },
      }),
      prisma.emailOtp.update({
        where: { id: token.otpId },
        data: { recoveryConfirmedAt: new Date() },
      }),
    ]);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new RecoveryError(
        "wallet_already_linked",
        "Wallet is already linked to another account.",
      );
    }
    throw err;
  }

  return {
    userId: user.id,
    walletAddress,
    recoveryLockedUntil: recoveryLockedUntil.toISOString(),
  };
}

function parseTokenOrThrow(value: unknown): RecoveryTokenPayload {
  if (typeof value !== "string") {
    throw new RecoveryError(
      "recovery_token_invalid",
      "Recovery token is invalid.",
    );
  }
  const parsed = parseRecoveryToken(value);
  if (!parsed) {
    throw new RecoveryError(
      "recovery_token_invalid",
      "Recovery token is invalid or expired.",
    );
  }
  return parsed;
}
