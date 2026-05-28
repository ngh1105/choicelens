import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import { RecoveryError } from "@/lib/auth/recovery";
import { resetInMemoryRateLimits } from "@/lib/rateLimit";

vi.mock("@/lib/auth/recovery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/recovery")>(
    "@/lib/auth/recovery",
  );
  return {
    ...actual,
    beginRecoveryWalletChallenge: vi.fn(),
  };
});

const { beginRecoveryWalletChallenge } = vi.mocked(
  await import("@/lib/auth/recovery"),
);

function request(body: unknown, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/auth/recovery/challenge", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/recovery/challenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryRateLimits();
  });

  it("creates a recovery wallet challenge", async () => {
    beginRecoveryWalletChallenge.mockResolvedValueOnce({
      nonce: "nonce_123",
      expiresAt: "2026-05-28T15:00:00.000Z",
    });

    const res = await POST(request({ recoveryToken: "token" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      nonce: "nonce_123",
      expiresAt: "2026-05-28T15:00:00.000Z",
    });
    expect(beginRecoveryWalletChallenge).toHaveBeenCalledWith({
      recoveryToken: "token",
    });
  });

  it("maps recovery errors", async () => {
    beginRecoveryWalletChallenge.mockRejectedValueOnce(
      new RecoveryError("recovery_token_invalid", "bad token"),
    );

    const res = await POST(request({ recoveryToken: "token" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "recovery_token_invalid",
    });
  });

  it("rate limits repeated challenge attempts for the same IP and token", async () => {
    beginRecoveryWalletChallenge.mockResolvedValue({
      nonce: "nonce_123",
      expiresAt: "2026-05-28T15:00:00.000Z",
    });

    for (let index = 0; index < 20; index += 1) {
      const res = await POST(
        request(
          { recoveryToken: "token" },
          { "x-forwarded-for": "203.0.113.10" },
        ),
      );
      expect(res.status).toBe(200);
    }

    const limited = await POST(
      request({ recoveryToken: "token" }, { "x-forwarded-for": "203.0.113.10" }),
    );

    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      error: "recovery_challenge_rate_limited",
    });
    expect(beginRecoveryWalletChallenge).toHaveBeenCalledTimes(20);
  });

  it("returns invalid_json for malformed JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/recovery/challenge", {
        method: "POST",
        body: "{",
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_json" });
  });
});
