import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyApiRateLimit,
  clientIp,
  rateLimitedResponse,
  resetRateLimitBackend,
  setRateLimitBackend,
} from "../apiRateLimit";
import { resetInMemoryRateLimits } from "../rateLimit";

beforeEach(() => {
  resetInMemoryRateLimits();
  resetRateLimitBackend();
});

afterEach(() => {
  resetRateLimitBackend();
});

describe("apiRateLimit", () => {
  it("allows requests under the limit and blocks above it", async () => {
    const req = new Request("http://test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    const a = await applyApiRateLimit(req, {
      scope: "test",
      limit: 2,
      windowMs: 60_000,
      identifier: "user_1",
    });
    const b = await applyApiRateLimit(req, {
      scope: "test",
      limit: 2,
      windowMs: 60_000,
      identifier: "user_1",
    });
    const c = await applyApiRateLimit(req, {
      scope: "test",
      limit: 2,
      windowMs: 60_000,
      identifier: "user_1",
    });

    expect(a.limited).toBe(false);
    expect(b.limited).toBe(false);
    expect(c.limited).toBe(true);
  });

  it("scopes buckets per ip + identifier", async () => {
    const req = new Request("http://test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    await applyApiRateLimit(req, {
      scope: "scope-iso",
      limit: 1,
      windowMs: 60_000,
      identifier: "user_a",
    });
    const otherUser = await applyApiRateLimit(req, {
      scope: "scope-iso",
      limit: 1,
      windowMs: 60_000,
      identifier: "user_b",
    });
    const sameUser = await applyApiRateLimit(req, {
      scope: "scope-iso",
      limit: 1,
      windowMs: 60_000,
      identifier: "user_a",
    });

    expect(otherUser.limited).toBe(false);
    expect(sameUser.limited).toBe(true);
  });

  it("uses x-forwarded-for first, falling back to other headers", () => {
    expect(
      clientIp(
        new Request("http://test", {
          headers: { "x-forwarded-for": "9.9.9.9, 7.7.7.7" },
        }),
      ),
    ).toBe("9.9.9.9");
    expect(
      clientIp(
        new Request("http://test", {
          headers: { "x-real-ip": "8.8.8.8" },
        }),
      ),
    ).toBe("8.8.8.8");
    expect(clientIp(new Request("http://test"))).toBe("unknown");
  });

  it("rateLimitedResponse returns 429 with Retry-After", async () => {
    const result = {
      limited: true,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSec: 30,
    };
    const res = rateLimitedResponse({ result, requestId: "req_1" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body).toMatchObject({
      error: "rate_limited",
      retryAfter: 30,
      requestId: "req_1",
    });
  });

  it("supports a custom backend", async () => {
    setRateLimitBackend(async () => ({
      limited: true,
      remaining: 0,
      resetAt: Date.now() + 1_000,
    }));
    const out = await applyApiRateLimit(
      new Request("http://test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
      { scope: "custom", limit: 100, windowMs: 1_000 },
    );
    expect(out.limited).toBe(true);
  });
});
