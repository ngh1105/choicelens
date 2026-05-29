import { PrismaClient } from "@prisma/client";
import { chromium, type APIRequestContext } from "playwright";
import { Wallet } from "ethers";
import { SiweMessage } from "siwe";
import { createHash } from "node:crypto";
import { RECOVERY_OTP_PURPOSE, hashOtpCode } from "../src/lib/auth/recoveryOtp";
import { createWalletSessionToken, WALLET_SESSION_COOKIE_NAME } from "../src/lib/auth/walletSession";
import { VISITOR_COOKIE_NAME, createVisitorId } from "../src/lib/visitor";

const prisma = new PrismaClient();

function shortId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

async function postJson(request: APIRequestContext, url: string, body: unknown) {
  const response = await request.post(url, {
    data: body,
    headers: { "content-type": "application/json" },
  });
  let json: any = null;
  const text = await response.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { response, json };
}

async function main() {
  process.env.APP_BASE_URL ||= "http://127.0.0.1:3000";
  process.env.WALLET_SESSION_SECRET ||= "local-smoke-wallet-session-secret";
  process.env.WALLET_RECOVERY_TOKEN_SECRET ||= "local-smoke-recovery-token-secret";

  const baseUrl = process.env.APP_BASE_URL;
  const email = `wallet-recovery-browser-${Date.now()}@example.test`;
  const oldWallet = Wallet.createRandom();
  const newWallet = Wallet.createRandom();
  const oldAddress = oldWallet.address;
  const newAddress = newWallet.address;
  const handle = `browser_${shortId(email)}`;
  const visitorHandle = `visitor_${shortId(email)}`;
  const otpCode = "123456";

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
    data: { handle: visitorHandle },
    select: { id: true },
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();

  try {
    await context.addCookies([
      {
        name: WALLET_SESSION_COOKIE_NAME,
        value: createWalletSessionToken({ userId: visitor.id, walletAddress: oldAddress }),
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: VISITOR_COOKIE_NAME,
        value: createVisitorId(),
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/recover", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /recover your account/i }).waitFor();

    const requestOtp = await postJson(context.request, "/api/auth/recovery/request", { email });
    if (requestOtp.response.status() !== 204) {
      throw new Error(`request OTP failed: ${requestOtp.response.status()} ${JSON.stringify(requestOtp.json)}`);
    }

    await prisma.emailOtp.updateMany({
      where: {
        userId: user.id,
        email,
        purpose: RECOVERY_OTP_PURPOSE,
        consumedAt: null,
      },
      data: { codeHash: hashOtpCode(otpCode), attempts: 0 },
    });

    const verifyOtp = await postJson(context.request, "/api/auth/recovery/verify", {
      email,
      code: otpCode,
    });
    if (verifyOtp.response.status() !== 200 || !verifyOtp.json?.recoveryToken) {
      throw new Error(`verify OTP failed: ${verifyOtp.response.status()} ${JSON.stringify(verifyOtp.json)}`);
    }
    const recoveryToken = verifyOtp.json.recoveryToken as string;

    const challenge = await postJson(context.request, "/api/auth/recovery/challenge", { recoveryToken });
    if (challenge.response.status() !== 200 || !challenge.json?.nonce) {
      throw new Error(`challenge failed: ${challenge.response.status()} ${JSON.stringify(challenge.json)}`);
    }

    const appUrl = new URL(baseUrl);
    const nonce = challenge.json.nonce as string;
    const message = new SiweMessage({
      domain: appUrl.host,
      address: newAddress,
      statement:
        "Recover ChoiceLens account access by binding this wallet as the new primary.",
      uri: appUrl.origin,
      version: "1",
      chainId: 1,
      nonce,
    }).prepareMessage();
    const signature = await newWallet.signMessage(message);
    const localVerify = await new SiweMessage(message).verify(
      {
        signature,
        domain: appUrl.host,
        nonce,
        time: new Date().toISOString(),
      },
      { suppressExceptions: true },
    );
    if (!localVerify.success) {
      throw new Error(`local SIWE verification failed: ${JSON.stringify(localVerify.error)}`);
    }

    const confirm = await postJson(context.request, "/api/auth/recovery/confirm", {
      recoveryToken,
      message,
      signature,
    });
    if (confirm.response.status() !== 200 || confirm.json?.walletAddress !== newAddress) {
      throw new Error(`confirm failed: ${confirm.response.status()} ${JSON.stringify(confirm.json)}`);
    }

    const cookies = await context.cookies(baseUrl);
    const walletCookie = cookies.find((cookie) => cookie.name === WALLET_SESSION_COOKIE_NAME);
    const visitorCookie = cookies.find((cookie) => cookie.name === VISITOR_COOKIE_NAME);
    if (!walletCookie?.value) {
      throw new Error("wallet session cookie was not set in browser context");
    }
    if (visitorCookie?.value) {
      throw new Error("visitor cookie was not cleared in browser context");
    }

    await page.goto("/account", { waitUntil: "networkidle" });
    await page.getByText(newAddress.slice(0, 6), { exact: false }).waitFor({ timeout: 10_000 });

    const finalUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { primaryWalletAddress: true, recoveryLockedUntil: true },
    });
    if (finalUser.primaryWalletAddress !== newAddress) {
      throw new Error("DB primary wallet was not swapped");
    }
    if (!finalUser.recoveryLockedUntil || finalUser.recoveryLockedUntil <= new Date()) {
      throw new Error("DB recovery cooldown was not set");
    }

    console.log("Browser wallet recovery smoke test passed.");
  } finally {
    await browser.close();
    await prisma.walletLinkRequest.deleteMany({ where: { userId: user.id } });
    await prisma.emailOtp.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, visitor.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
