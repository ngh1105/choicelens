import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyApiRateLimit,
  resetRateLimitBackend,
  setRateLimitBackend,
} from "../apiRateLimit";
import { createUpstashRateLimitBackend } from "../rateLimit.upstash";

beforeEach(() => {
  resetRateLimitBackend();
});

afterEach(() => {
  resetRateLimitBackend();
  vi.restoreAllMocks();
});

describe("createUpstashRateLimitBackend", () => {
  it("issues an INCR + PTTL pipeline and reports remaining budget", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify([{ result: 1 }, { result: -1 }]),
        { status: 200 },
      );
    };

    const backend = createUpstashRateLimitBackend({
      url: "https://example.upstash.io",
      token: "tok",
      fetchImpl,
    });
    setRateLimitBackend(backend);

    const result = await applyApiRateLimit(
      new Request("http://test", { headers: { "x-forwarded-for": "1.2.3.4" } }),
      { scope: "upstash:test", limit: 5, windowMs: 60_000, identifier: "u" },
    );

    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(4);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://example.upstash.io/pipeline");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("flags limited when count exceeds limit", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify([{ result: 11 }, { result: 30_000 }]),
        { status: 200 },
      );

    setRateLimitBackend(
      createUpstashRateLimitBackend({
        url: "https://example.upstash.io",
        token: "tok",
        fetchImpl,
      }),
    );

    const result = await applyApiRateLimit(
      new Request("http://test", { headers: { "x-forwarded-for": "1.2.3.4" } }),
      { scope: "upstash:test", limit: 10, windowMs: 60_000, identifier: "u" },
    );

    expect(result.limited).toBe(true);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("propagates upstream errors as Error", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("nope", { status: 500, statusText: "boom" });

    setRateLimitBackend(
      createUpstashRateLimitBackend({
        url: "https://example.upstash.io",
        token: "tok",
        fetchImpl,
      }),
    );

    await expect(
      applyApiRateLimit(
        new Request("http://test", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        }),
        { scope: "upstash:err", limit: 10, windowMs: 1_000 },
      ),
    ).rejects.toThrow(/Upstash rate-limit pipeline failed/);
  });
});
