import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const WALLET_SESSION_COOKIE_NAME = "cl_wallet_session";
export const WALLET_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface WalletSession {
  userId: string;
  walletAddress: string;
  issuedAt: number;
  expiresAt: number;
}

interface EncodedSession {
  userId: string;
  walletAddress: string;
  issuedAt: number;
  expiresAt: number;
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

function getSessionSecret(): string {
  const secret = process.env.WALLET_SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("WALLET_SESSION_SECRET is required in production.");
  }
  return "dev-wallet-session-secret";
}

function sign(payload: string): string {
  return base64url(
    createHmac("sha256", getSessionSecret()).update(payload).digest(),
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isEncodedSession(value: unknown): value is EncodedSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "string" &&
    typeof record.walletAddress === "string" &&
    typeof record.issuedAt === "number" &&
    typeof record.expiresAt === "number"
  );
}

export function createWalletSessionToken(args: {
  userId: string;
  walletAddress: string;
  now?: Date;
}): string {
  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  const payload: EncodedSession = {
    userId: args.userId,
    walletAddress: args.walletAddress,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + WALLET_SESSION_MAX_AGE_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function parseWalletSessionToken(
  value: string | null | undefined,
  now = new Date(),
): WalletSession | null {
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
  if (!isEncodedSession(parsed)) return null;
  if (parsed.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
  return parsed;
}

export function createNonce(): string {
  return randomBytes(12).toString("hex");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const cookieName = part.slice(0, index).trim();
    if (cookieName !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function applyWalletSessionCookie<T extends NextResponse>(
  response: T,
  token: string,
): T {
  response.cookies.set({
    name: WALLET_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WALLET_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export function clearWalletSessionCookie<T extends NextResponse>(response: T): T {
  response.cookies.set({
    name: WALLET_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
