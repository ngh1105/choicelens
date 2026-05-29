import { prisma } from "@/lib/db";
import {
  consumeOtp,
  EMAIL_VERIFY_OTP_PURPOSE,
  isOtpError,
  issueOtp,
  OtpError,
} from "@/lib/auth/recoveryOtp";
import {
  isEmailEnabled,
  isEmailSendError,
  type EmailSendError,
} from "@/lib/email/resend";
import { sendEmailVerifyOtpEmail } from "@/lib/email/templates";
import { parseRecoveryEmail } from "@/lib/account";

export class EmailVerifyError extends Error {
  code:
    | "recovery_email_missing"
    | "recovery_email_already_verified"
    | "email_send_failed";

  constructor(code: EmailVerifyError["code"], message: string) {
    super(message);
    this.name = "EmailVerifyError";
    this.code = code;
  }
}

export function isEmailVerifyError(value: unknown): value is EmailVerifyError {
  return value instanceof EmailVerifyError;
}

export interface RequestEmailVerifyResult {
  delivered: boolean;
  expiresAt: string;
}

/**
 * Issues an email-verify OTP for the wallet-authenticated user's recovery
 * email. The endpoint that calls this is wallet-gated, so unlike recovery we
 * surface real errors back to the caller.
 */
export async function requestEmailVerifyOtp(args: {
  userId: string;
}): Promise<RequestEmailVerifyResult> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { recoveryEmail: true, recoveryEmailVerifiedAt: true },
  });
  if (!user || !user.recoveryEmail) {
    throw new EmailVerifyError(
      "recovery_email_missing",
      "Set a recovery email before verifying it.",
    );
  }
  if (user.recoveryEmailVerifiedAt) {
    throw new EmailVerifyError(
      "recovery_email_already_verified",
      "Recovery email is already verified.",
    );
  }

  const issued = await issueOtp({
    email: user.recoveryEmail,
    userId: args.userId,
    purpose: EMAIL_VERIFY_OTP_PURPOSE,
  });

  if (!isEmailEnabled()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[email-verify] OTP for ${user.recoveryEmail}: ${issued.code} (expires ${issued.expiresAt.toISOString()})`,
      );
    }
    return { delivered: false, expiresAt: issued.expiresAt.toISOString() };
  }

  try {
    await sendEmailVerifyOtpEmail({
      to: user.recoveryEmail,
      code: issued.code,
      expiresAt: issued.expiresAt,
    });
  } catch (err) {
    if (isEmailSendError(err)) {
      const sendErr = err as EmailSendError;
      console.error("email-verify send failed", sendErr.code, sendErr.message);
      throw new EmailVerifyError(
        "email_send_failed",
        "Failed to send verification email.",
      );
    }
    throw err;
  }
  return { delivered: true, expiresAt: issued.expiresAt.toISOString() };
}

export interface ConfirmEmailVerifyResult {
  recoveryEmail: string;
  recoveryEmailVerifiedAt: string;
}

export async function confirmEmailVerifyOtp(args: {
  userId: string;
  code: unknown;
}): Promise<ConfirmEmailVerifyResult> {
  if (typeof args.code !== "string" || !/^\d{6}$/.test(args.code.trim())) {
    throw new OtpError(
      "otp_invalid_or_expired",
      "OTP is invalid or has expired.",
    );
  }
  const code = args.code.trim();

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { recoveryEmail: true, recoveryEmailVerifiedAt: true },
  });
  if (!user || !user.recoveryEmail) {
    throw new EmailVerifyError(
      "recovery_email_missing",
      "Set a recovery email before verifying it.",
    );
  }
  if (user.recoveryEmailVerifiedAt) {
    throw new EmailVerifyError(
      "recovery_email_already_verified",
      "Recovery email is already verified.",
    );
  }

  // Tolerate parseRecoveryEmail's normalization (lowercase + trim).
  const email = parseRecoveryEmail(user.recoveryEmail);
  if (!email) {
    throw new EmailVerifyError(
      "recovery_email_missing",
      "Set a recovery email before verifying it.",
    );
  }

  // Scope consume to userId so a code stolen from one inbox can't be
  // burned against a different account.
  try {
    await consumeOtp({
      email,
      purpose: EMAIL_VERIFY_OTP_PURPOSE,
      code,
      userId: args.userId,
    });
  } catch (err) {
    if (isOtpError(err)) throw err;
    throw err;
  }

  const verifiedAt = new Date();
  await prisma.user.update({
    where: { id: args.userId },
    data: { recoveryEmailVerifiedAt: verifiedAt },
  });

  return {
    recoveryEmail: email,
    recoveryEmailVerifiedAt: verifiedAt.toISOString(),
  };
}
