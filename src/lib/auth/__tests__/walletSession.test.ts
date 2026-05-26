import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import {
  WALLET_SESSION_COOKIE_NAME,
  WALLET_SESSION_MAX_AGE_SECONDS,
  applyWalletSessionCookie,
  clearWalletSessionCookie,
  createNonce,
  createWalletSessionToken,
  parseWalletSessionToken,
  readCookie,
} from "../walletSession";

beforeEach(() => {
  vi.stubEnv("WALLET_SESSION_SECRET", "test-wallet-session-secret");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const userId = "user_1";
const walletAddress = "0x0000000000000000000000000000000000000001";

describe("createWalletSessionToken / parseWalletSessionToken", () => {
  it("round-trips a session with the same secret", () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    const token = createWalletSessionToken({ userId, walletAddress, now });

    const parsed = parseWalletSessionToken(token, now);

    expect(parsed).not.toBeNull();
    expect(parsed?.userId).toBe(userId);
    expect(parsed?.walletAddress).toBe(walletAddress);
    if (!parsed) throw new Error("parsed is null");
    expect(parsed.expiresAt - parsed.issuedAt).toBe(
      WALLET_SESSION_MAX_AGE_SECONDS,
    );
  });

  it("returns null for null or empty input", () => {
    expect(parseWalletSessionToken(null)).toBeNull();
    expect(parseWalletSessionToken(undefined)).toBeNull();
    expect(parseWalletSessionToken("")).toBeNull();
  });

  it("returns null when the token format is wrong (extra segments)", () => {
    const token = createWalletSessionToken({ userId, walletAddress });

    expect(parseWalletSessionToken(`${token}.extra`)).toBeNull();
  });

  it("returns null when the token has only one segment", () => {
    expect(parseWalletSessionToken("just-a-payload")).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    const token = createWalletSessionToken({ userId, walletAddress, now });

    vi.stubEnv("WALLET_SESSION_SECRET", "rotated-secret");

    expect(parseWalletSessionToken(token, now)).toBeNull();
  });

  it("rejects tokens whose payload was tampered with", () => {
    const token = createWalletSessionToken({ userId, walletAddress });
    const [, signature] = token.split(".");
    const tampered = `${Buffer.from('{"userId":"attacker"}').toString("base64url")}.${signature}`;

    expect(parseWalletSessionToken(tampered)).toBeNull();
  });

  it("rejects tokens whose payload is not a valid encoded session", () => {
    const encoded = Buffer.from('"a string"').toString("base64url");
    const { createHmac } = require("node:crypto");
    const sig = Buffer.from(
      createHmac("sha256", "test-wallet-session-secret")
        .update(encoded)
        .digest(),
    )
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/g, "");

    expect(parseWalletSessionToken(`${encoded}.${sig}`)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const issuedAt = new Date("2026-05-23T00:00:00.000Z");
    const token = createWalletSessionToken({
      userId,
      walletAddress,
      now: issuedAt,
    });
    const wayLater = new Date(
      issuedAt.getTime() + (WALLET_SESSION_MAX_AGE_SECONDS + 60) * 1000,
    );

    expect(parseWalletSessionToken(token, wayLater)).toBeNull();
  });

  it("returns null when payload base64 decodes to non-JSON", () => {
    const encoded = Buffer.from("not json").toString("base64url");
    const { createHmac } = require("node:crypto");
    const sig = Buffer.from(
      createHmac("sha256", "test-wallet-session-secret")
        .update(encoded)
        .digest(),
    )
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/g, "");

    expect(parseWalletSessionToken(`${encoded}.${sig}`)).toBeNull();
  });

  it("falls back to dev secret when WALLET_SESSION_SECRET is missing in non-production", () => {
    vi.stubEnv("WALLET_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");

    const token = createWalletSessionToken({ userId, walletAddress });
    const parsed = parseWalletSessionToken(token);

    expect(parsed?.userId).toBe(userId);
  });

  it("throws when WALLET_SESSION_SECRET is missing in production", () => {
    vi.stubEnv("WALLET_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() =>
      createWalletSessionToken({ userId, walletAddress }),
    ).toThrowError(/WALLET_SESSION_SECRET/);
  });
});

describe("createNonce", () => {
  it("returns a 24-char hex string (12 random bytes) and is non-deterministic", () => {
    const a = createNonce();
    const b = createNonce();

    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(b).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});

describe("readCookie", () => {
  function withCookie(value: string | undefined): Request {
    return new Request(
      "http://test/",
      value ? { headers: { cookie: value } } : undefined,
    );
  }

  it("returns null when no cookie header is present", () => {
    expect(readCookie(withCookie(undefined), WALLET_SESSION_COOKIE_NAME)).toBeNull();
  });

  it("returns the named cookie value", () => {
    const req = withCookie(
      `other=foo; ${WALLET_SESSION_COOKIE_NAME}=encoded.payload; trailing=bar`,
    );

    expect(readCookie(req, WALLET_SESSION_COOKIE_NAME)).toBe("encoded.payload");
  });

  it("ignores cookie segments with no `=`", () => {
    const req = withCookie(`flag; ${WALLET_SESSION_COOKIE_NAME}=value`);

    expect(readCookie(req, WALLET_SESSION_COOKIE_NAME)).toBe("value");
  });

  it("returns null when the named cookie is absent", () => {
    expect(
      readCookie(withCookie("other=1; another=2"), WALLET_SESSION_COOKIE_NAME),
    ).toBeNull();
  });

  it("URL-decodes percent-encoded values", () => {
    const req = withCookie(`${WALLET_SESSION_COOKIE_NAME}=hello%20world`);

    expect(readCookie(req, WALLET_SESSION_COOKIE_NAME)).toBe("hello world");
  });

  it("falls back to the raw value if decoding fails", () => {
    const req = withCookie(`${WALLET_SESSION_COOKIE_NAME}=%E0%A4%A`);

    expect(readCookie(req, WALLET_SESSION_COOKIE_NAME)).toBe("%E0%A4%A");
  });
});

describe("applyWalletSessionCookie / clearWalletSessionCookie", () => {
  it("sets HttpOnly + SameSite=Lax + Path=/ + Max-Age and Secure off in non-production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = NextResponse.json({});

    applyWalletSessionCookie(response, "tok_1");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${WALLET_SESSION_COOKIE_NAME}=tok_1`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${WALLET_SESSION_MAX_AGE_SECONDS}`);
    expect(setCookie).not.toContain("Secure");
  });

  it("sets Secure flag when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WALLET_SESSION_SECRET", "prod-test-secret");
    const response = NextResponse.json({});

    applyWalletSessionCookie(response, "tok_2");

    expect(response.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it("clearWalletSessionCookie sets Max-Age=0 for the same cookie name", () => {
    const response = NextResponse.json({});

    clearWalletSessionCookie(response);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${WALLET_SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
  });
});
