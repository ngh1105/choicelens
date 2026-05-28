import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  normalizeWalletAddress,
  verifySiweMessage,
} from "@/lib/auth/siwe";
import { createNonce } from "@/lib/auth/walletSession";
import { resolvePlanId, type PlanId } from "@/lib/plans";

export const WALLET_CHANGE_TTL_MS = 10 * 60 * 1000;

export interface AccountSummary {
  plan: PlanId;
  effectivePlan: PlanId;
  primaryWalletAddress: string | null;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionStatus: string | null;
  stripeCurrentPeriodEnd: string | null;
}

export class AccountError extends Error {
  code:
    | "account_not_found"
    | "recovery_email_invalid"
    | "recovery_email_already_used"
    | "wallet_session_required"
    | "wallet_invalid"
    | "wallet_already_linked"
    | "wallet_same_as_current"
    | "wallet_change_not_found";

  constructor(code: AccountError["code"], message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function formatAccountSummary(user: {
  plan: string;
  primaryWalletAddress: string | null;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionStatus: string | null;
  stripeCurrentPeriodEnd: Date | null;
}): AccountSummary {
  const plan = resolvePlanId(user.plan);
  return {
    plan,
    effectivePlan: plan,
    primaryWalletAddress: user.primaryWalletAddress,
    recoveryEmail: user.recoveryEmail,
    recoveryEmailVerifiedAt: toIso(user.recoveryEmailVerifiedAt),
    stripeCustomerId: user.stripeCustomerId,
    stripeSubscriptionStatus: user.stripeSubscriptionStatus,
    stripeCurrentPeriodEnd: toIso(user.stripeCurrentPeriodEnd),
  };
}

export async function getAccountSummary(userId: string): Promise<AccountSummary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      plan: true,
      primaryWalletAddress: true,
      recoveryEmail: true,
      recoveryEmailVerifiedAt: true,
      stripeCustomerId: true,
      stripeSubscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
    },
  });
  if (!user) {
    throw new AccountError("account_not_found", "Account was not found.");
  }
  return formatAccountSummary(user);
}

export function parseRecoveryEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new AccountError(
      "recovery_email_invalid",
      "Recovery email is invalid.",
    );
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (
    trimmed.length > 254 ||
    trimmed.includes(" ") ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)
  ) {
    throw new AccountError(
      "recovery_email_invalid",
      "Recovery email is invalid.",
    );
  }
  return trimmed;
}

export async function updateRecoveryEmail(
  userId: string,
  value: unknown,
): Promise<string | null> {
  const recoveryEmail = parseRecoveryEmail(value);
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { recoveryEmail: true },
  });
  if (!current) {
    throw new AccountError("account_not_found", "Account was not found.");
  }

  // Reset verification when the email actually changes (or is cleared).
  // Setting the same email back keeps the existing verifiedAt timestamp.
  const data: {
    recoveryEmail: string | null;
    recoveryEmailVerifiedAt?: Date | null;
  } = { recoveryEmail };
  if (current.recoveryEmail !== recoveryEmail) {
    data.recoveryEmailVerifiedAt = null;
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { recoveryEmail: true },
    });
    return user.recoveryEmail;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      Array.isArray(err.meta?.target) &&
      err.meta.target.includes("recoveryEmail")
    ) {
      throw new AccountError(
        "recovery_email_already_used",
        "Recovery email is already used by another account.",
      );
    }
    throw err;
  }
}

export async function createWalletChangeRequest(args: {
  userId: string;
  currentWalletAddress: string | null;
  requestedWalletAddress: unknown;
}): Promise<{ id: string; challengeNonce: string; expiresAt: string }> {
  if (!args.currentWalletAddress) {
    throw new AccountError(
      "wallet_session_required",
      "Wallet session is required.",
    );
  }
  if (typeof args.requestedWalletAddress !== "string") {
    throw new AccountError("wallet_invalid", "Wallet address is invalid.");
  }

  const requestedWalletAddress = normalizeWalletAddress(
    args.requestedWalletAddress,
  );
  if (requestedWalletAddress === normalizeWalletAddress(args.currentWalletAddress)) {
    throw new AccountError(
      "wallet_same_as_current",
      "Requested wallet matches the current primary wallet.",
    );
  }

  const existing = await prisma.user.findUnique({
    where: { primaryWalletAddress: requestedWalletAddress },
    select: { id: true },
  });
  if (existing && existing.id !== args.userId) {
    throw new AccountError(
      "wallet_already_linked",
      "Wallet is already linked to another account.",
    );
  }

  const request = await prisma.walletLinkRequest.create({
    data: {
      userId: args.userId,
      requestedWalletAddress,
      challengeNonce: createNonce(),
      status: "wallet_change_requested",
      expiresAt: new Date(Date.now() + WALLET_CHANGE_TTL_MS),
    },
    select: {
      id: true,
      challengeNonce: true,
      expiresAt: true,
    },
  });

  return {
    id: request.id,
    challengeNonce: request.challengeNonce,
    expiresAt: request.expiresAt.toISOString(),
  };
}

export async function confirmWalletChange(args: {
  userId: string;
  currentWalletAddress: string | null;
  requestId: unknown;
  message: unknown;
  signature: unknown;
}): Promise<{ walletAddress: string }> {
  if (!args.currentWalletAddress) {
    throw new AccountError(
      "wallet_session_required",
      "Wallet session is required.",
    );
  }
  if (
    typeof args.requestId !== "string" ||
    typeof args.message !== "string" ||
    typeof args.signature !== "string"
  ) {
    throw new AccountError(
      "wallet_change_not_found",
      "Wallet change request was not found.",
    );
  }

  const request = await prisma.walletLinkRequest.findFirst({
    where: {
      id: args.requestId,
      userId: args.userId,
      status: "wallet_change_requested",
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      challengeNonce: true,
      requestedWalletAddress: true,
    },
  });
  if (!request) {
    throw new AccountError(
      "wallet_change_not_found",
      "Wallet change request was not found.",
    );
  }

  const { walletAddress } = await verifySiweMessage({
    message: args.message,
    signature: args.signature,
    nonce: request.challengeNonce,
    expectedAddress: request.requestedWalletAddress,
  });
  if (walletAddress === normalizeWalletAddress(args.currentWalletAddress)) {
    throw new AccountError(
      "wallet_same_as_current",
      "Requested wallet matches the current primary wallet.",
    );
  }

  const existing = await prisma.user.findUnique({
    where: { primaryWalletAddress: walletAddress },
    select: { id: true },
  });
  if (existing && existing.id !== args.userId) {
    throw new AccountError(
      "wallet_already_linked",
      "Wallet is already linked to another account.",
    );
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: args.userId },
      data: {
        primaryWalletAddress: walletAddress,
        walletLinkedAt: new Date(),
      },
    }),
    prisma.walletLinkRequest.update({
      where: { id: request.id },
      data: { status: "confirmed", confirmedAt: new Date() },
    }),
  ]).catch((err) => {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AccountError(
        "wallet_already_linked",
        "Wallet is already linked to another account.",
      );
    }
    throw err;
  });

  return { walletAddress };
}

export function isAccountError(value: unknown): value is AccountError {
  return value instanceof AccountError;
}

