interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface InMemoryRateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}

const buckets = new Map<string, RateLimitEntry>();

export function checkInMemoryRateLimit({
  key,
  limit,
  windowMs,
  now = Date.now(),
}: InMemoryRateLimitOptions): { limited: boolean; remaining: number; resetAt: number } {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { limited: false, remaining: Math.max(0, limit - 1), resetAt };
  }

  if (existing.count >= limit) {
    return { limited: true, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    limited: false,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

export function resetInMemoryRateLimits(): void {
  buckets.clear();
}
