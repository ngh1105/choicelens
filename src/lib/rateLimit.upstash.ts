import type {
  InMemoryRateLimitOptions,
} from "@/lib/rateLimit";
import type { RateLimitBackend } from "@/lib/apiRateLimit";

export interface UpstashRedisConfig {
  url: string;
  token: string;
  /**
   * Optional override for the global fetch. Useful for tests; defaults to
   * the global fetch available in the runtime.
   */
  fetchImpl?: typeof fetch;
}

interface PipelineResult {
  result: number | string;
}

/**
 * Build an Upstash Redis-backed rate-limit backend that is API compatible
 * with the in-memory backend in `src/lib/rateLimit.ts`.
 *
 * Strategy: fixed window counter using `INCR` + `PEXPIRE` per-key. This is
 * deliberately simple and matches the in-memory semantics. For very tight
 * budgets, swap in a sliding-window or token-bucket script later.
 *
 * Usage in app bootstrap:
 *
 *   const url = process.env.UPSTASH_REDIS_REST_URL;
 *   const token = process.env.UPSTASH_REDIS_REST_TOKEN;
 *   if (url && token) {
 *     setRateLimitBackend(createUpstashRateLimitBackend({ url, token }));
 *   }
 */
export function createUpstashRateLimitBackend(
  config: UpstashRedisConfig,
): RateLimitBackend {
  const fetchImpl = config.fetchImpl ?? fetch;

  async function pipeline(
    commands: ReadonlyArray<ReadonlyArray<string>>,
  ): Promise<PipelineResult[]> {
    const res = await fetchImpl(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) {
      throw new Error(
        `Upstash rate-limit pipeline failed: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as PipelineResult[];
  }

  return async (
    options: InMemoryRateLimitOptions,
  ): Promise<{ limited: boolean; remaining: number; resetAt: number }> => {
    const namespacedKey = `cl:rl:${options.key}`;
    const ttlMs = options.windowMs;

    const [incrResult, pttlResult] = await pipeline([
      ["INCR", namespacedKey],
      ["PTTL", namespacedKey],
    ]);

    const count =
      typeof incrResult.result === "number"
        ? incrResult.result
        : Number(incrResult.result);
    let pttl =
      typeof pttlResult.result === "number"
        ? pttlResult.result
        : Number(pttlResult.result);

    // First time we saw this key, attach a TTL.
    if (count === 1 || pttl < 0) {
      await pipeline([["PEXPIRE", namespacedKey, String(ttlMs)]]);
      pttl = ttlMs;
    }

    const resetAt = Date.now() + Math.max(pttl, 0);
    if (count > options.limit) {
      return { limited: true, remaining: 0, resetAt };
    }
    return {
      limited: false,
      remaining: Math.max(0, options.limit - count),
      resetAt,
    };
  };
}
