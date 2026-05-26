import { SiweMessage } from "siwe";
import { getAddress, isAddress } from "viem";
import { prisma } from "@/lib/db";
import { createNonce } from "./walletSession";

export const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;

export class SiweAuthError extends Error {
  code:
    | "invalid_wallet"
    | "nonce_not_found"
    | "siwe_rejected"
    | "wallet_change_conflict";

  constructor(code: SiweAuthError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "SiweAuthError";
  }
}

export function appBaseUrl(): URL {
  return new URL(process.env.APP_BASE_URL || "http://localhost:3000");
}

export function normalizeWalletAddress(value: string): string {
  if (!isAddress(value)) {
    throw new SiweAuthError("invalid_wallet", "Wallet address is invalid.");
  }
  return getAddress(value);
}

export async function createSiweNonce(userId: string): Promise<string> {
  const nonce = createNonce();
  await prisma.walletLinkRequest.create({
    data: {
      userId,
      requestedWalletAddress: "0x0000000000000000000000000000000000000000",
      challengeNonce: nonce,
      status: "siwe_nonce",
      expiresAt: new Date(Date.now() + SIWE_NONCE_TTL_MS),
    },
  });
  return nonce;
}

export async function verifySiweMessage(args: {
  message: string;
  signature: string;
  nonce: string;
  expectedAddress?: string;
}): Promise<{ walletAddress: string }> {
  const siwe = new SiweMessage(args.message);
  const baseUrl = appBaseUrl();
  const response = await siwe.verify(
    {
      signature: args.signature,
      domain: baseUrl.host,
      nonce: args.nonce,
      time: new Date().toISOString(),
    },
    { suppressExceptions: true },
  );
  if (!response.success) {
    throw new SiweAuthError("siwe_rejected", "Wallet signature could not be verified.");
  }

  const walletAddress = normalizeWalletAddress(siwe.address);
  if (
    args.expectedAddress &&
    walletAddress !== normalizeWalletAddress(args.expectedAddress)
  ) {
    throw new SiweAuthError("siwe_rejected", "Wallet signature did not match request.");
  }
  return { walletAddress };
}

export async function verifySiweForUser(args: {
  userId: string;
  message: string;
  signature: string;
}): Promise<{ walletAddress: string }> {
  const siwe = new SiweMessage(args.message);
  const nonce = siwe.nonce;
  const nonceRecord = await prisma.walletLinkRequest.findFirst({
    where: {
      userId: args.userId,
      challengeNonce: nonce,
      status: "siwe_nonce",
      expiresAt: { gt: new Date() },
    },
  });
  if (!nonceRecord) {
    throw new SiweAuthError("nonce_not_found", "SIWE nonce is missing or expired.");
  }

  const baseUrl = appBaseUrl();
  if (siwe.domain !== baseUrl.host) {
    throw new SiweAuthError("siwe_rejected", "Wallet signature could not be verified.");
  }
  const { walletAddress } = await verifySiweMessage({
    message: args.message,
    signature: args.signature,
    nonce,
  });

  await prisma.walletLinkRequest.update({
    where: { id: nonceRecord.id },
    data: { status: "used", confirmedAt: new Date() },
  });
  return { walletAddress };
}

export function isSiweAuthError(value: unknown): value is SiweAuthError {
  return value instanceof SiweAuthError;
}
