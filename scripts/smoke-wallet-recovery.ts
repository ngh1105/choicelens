import { PrismaClient } from "@prisma/client";
import { Wallet } from "ethers";
import { SiweMessage } from "siwe";
import { createHash } from "node:crypto";
import {
  beginRecoveryWalletChallenge,
  confirmRecovery,
  requestRecoveryOtp,
  verifyRecoveryOtp,
} from "../src/lib/auth/recovery";
import {
  RECOVERY_OTP_PURPOSE,
  hashOtpCode,
} from "../src/lib/auth/recoveryOtp";
import { createWalletSessionToken, parseWalletSessionToken } from "../src/lib/auth/walletSession";

const prisma = new PrismaClient();

function shortId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

async function main() {
  process.env.APP_BASE_URL ||= "http://localhost:3000";
  process.env.WALLET_SESSION_SECRET ||= "local-smoke-wallet-session-secret";
  process.env.WALLET_RECOVERY_TOKEN_SECRET ||= "local-smoke-recovery-token-secret";

  const email = `wallet-recovery-smoke-${Date.now()}@example.test`;
  const oldWallet = Wallet.createRandom();
  const newWallet = Wallet.createRandom();
  const oldAddress = oldWallet.address;
  const newAddress = newWallet.address;
  const handle = `smoke_${shortId(email)}`;
  const otpCode = "123456";

  console.log("Creating smoke user", { email, oldAddress, newAddress });

  const user = await prisma.user.create({
    data: {
      handle,
      primaryWalletAddress: oldAddress,
      walletLinkedAt: new Date(),
      recoveryEmail: email,
      recoveryEmailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  const visitor = await prisma.user.create({
    data: { handle: `visitor_${shortId(email)}` },
    select: { id: true },
  });
  const visitorSessionToken = createWalletSessionToken({
    userId: visitor.id,
    walletAddress: oldAddress,
  });
  const visitorSession = parseWalletSessionToken(visitorSessionToken);

  try {
    const requested = await requestRecoveryOtp({ email });
    console.log("requestRecoveryOtp", requested);

    await prisma.emailOtp.updateMany({
      where: {
        userId: user.id,
        email,
        purpose: RECOVERY_OTP_PURPOSE,
        consumedAt: null,
      },
      data: { codeHash: hashOtpCode(otpCode), attempts: 0 },
    });

    const verified = await verifyRecoveryOtp({ email, code: otpCode });
    console.log("verifyRecoveryOtp", { tokenIssued: Boolean(verified.recoveryToken) });

    const challenge = await beginRecoveryWalletChallenge({
      recoveryToken: verified.recoveryToken,
    });
    console.log("beginRecoveryWalletChallenge", { nonce: challenge.nonce });

    const baseUrl = new URL(process.env.APP_BASE_URL);
    const message = new SiweMessage({
      domain: baseUrl.host,
      address: newAddress,
      statement:
        "Recover ChoiceLens account access by binding this wallet as the new primary.",
      uri: baseUrl.origin,
      version: "1",
      chainId: 1,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    }).prepareMessage();
    const signature = await newWallet.signMessage(message);

    const confirmed = await confirmRecovery({
      recoveryToken: verified.recoveryToken,
      message,
      signature,
    });
    console.log("confirmRecovery", confirmed);

    const finalUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        primaryWalletAddress: true,
        recoveryLockedUntil: true,
        walletLinkedAt: true,
      },
    });
    const otp = await prisma.emailOtp.findFirstOrThrow({
      where: { userId: user.id, email, purpose: RECOVERY_OTP_PURPOSE },
      orderBy: { createdAt: "desc" },
      select: { consumedAt: true, recoveryConfirmedAt: true },
    });
    const nonce = await prisma.walletLinkRequest.findFirstOrThrow({
      where: { userId: user.id, status: "recovery_used" },
      orderBy: { createdAt: "desc" },
      select: { requestedWalletAddress: true, status: true, confirmedAt: true },
    });

    if (finalUser.primaryWalletAddress !== newAddress) {
      throw new Error("primary wallet was not swapped to the new wallet");
    }
    if (!finalUser.walletLinkedAt) {
      throw new Error("walletLinkedAt was not set");
    }
    if (!finalUser.recoveryLockedUntil || finalUser.recoveryLockedUntil <= new Date()) {
      throw new Error("recovery cooldown was not set");
    }
    if (!otp.consumedAt || !otp.recoveryConfirmedAt) {
      throw new Error("OTP was not consumed and marked confirmed");
    }
    if (nonce.status !== "recovery_used" || !nonce.confirmedAt) {
      throw new Error("recovery nonce was not consumed");
    }
    if (!visitorSession || visitorSession.userId !== visitor.id) {
      throw new Error("visitor session fixture failed");
    }

    console.log("Wallet recovery smoke test passed.");
  } finally {
    await prisma.walletLinkRequest.deleteMany({ where: { userId: user.id } });
    await prisma.emailOtp.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, visitor.id] } } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
