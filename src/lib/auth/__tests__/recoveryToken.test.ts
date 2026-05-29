import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECOVERY_TOKEN_TTL_MS,
  createRecoveryToken,
  parseRecoveryToken,
} from "../recoveryToken";

beforeEach(() => {
  vi.stubEnv("WALLET_SESSION_SECRET", "test-recovery-secret");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const userId = "user_1";
const email = "alice@example.com";
const otpId = "otp_1";

describe("createRecoveryToken / parseRecoveryToken", () => {
  it("round-trips with the same secret", () => {
    const now = new Date("2026-05-28T00:00:00Z");
    const token = createRecoveryToken({ userId, email, otpId, now });
    const parsed = parseRecoveryToken(token, now);
    expect(parsed?.userId).toBe(userId);
    expect(parsed?.email).toBe(email);
    expect(parsed?.otpId).toBe(otpId);
    expect((parsed!.expiresAt - parsed!.issuedAt) * 1000).toBe(
      RECOVERY_TOKEN_TTL_MS,
    );
  });

  it("returns null for empty input", () => {
    expect(parseRecoveryToken(null)).toBeNull();
    expect(parseRecoveryToken(undefined)).toBeNull();
    expect(parseRecoveryToken("")).toBeNull();
  });

  it("returns null when format is wrong", () => {
    const token = createRecoveryToken({ userId, email, otpId });
    expect(parseRecoveryToken(`${token}.extra`)).toBeNull();
    expect(parseRecoveryToken("notadottoken")).toBeNull();
  });

  it("rejects tokens when recovery token secret changes", () => {
    vi.stubEnv("WALLET_RECOVERY_TOKEN_SECRET", "specific-recovery-secret");
    const token = createRecoveryToken({ userId, email, otpId });
    vi.stubEnv("WALLET_RECOVERY_TOKEN_SECRET", "rotated");
    expect(parseRecoveryToken(token)).toBeNull();
  });

  it("falls back to wallet session secret with recovery domain separation", () => {
    vi.stubEnv("WALLET_RECOVERY_TOKEN_SECRET", "");
    vi.stubEnv("WALLET_SESSION_SECRET", "session-secret");
    const token = createRecoveryToken({ userId, email, otpId });
    expect(parseRecoveryToken(token)?.userId).toBe(userId);
  });

  it("rejects tokens signed with a different secret", () => {
    const token = createRecoveryToken({ userId, email, otpId });
    vi.stubEnv("WALLET_SESSION_SECRET", "rotated");
    expect(parseRecoveryToken(token)).toBeNull();
  });

  it("rejects tokens with tampered payload", () => {
    const token = createRecoveryToken({ userId, email, otpId });
    const [, signature] = token.split(".");
    const tampered = `${Buffer.from('{"userId":"attacker"}').toString("base64url")}.${signature}`;
    expect(parseRecoveryToken(tampered)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const issuedAt = new Date("2026-05-28T00:00:00Z");
    const token = createRecoveryToken({ userId, email, otpId, now: issuedAt });
    const later = new Date(issuedAt.getTime() + RECOVERY_TOKEN_TTL_MS + 1000);
    expect(parseRecoveryToken(token, later)).toBeNull();
  });
});
