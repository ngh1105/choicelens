import {
  setRateLimitBackend,
  type RateLimitBackend,
} from "@/lib/apiRateLimit";
import { createUpstashRateLimitBackend } from "@/lib/rateLimit.upstash";

let installed = false;

/**
 * Wire a shared rate-limit backend if Upstash credentials are present. Called
 * lazily from runtime modules; safe to call multiple times.
 */
export function ensureSharedRateLimitBackend(): RateLimitBackend | null {
  if (installed) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  const backend = createUpstashRateLimitBackend({ url, token });
  setRateLimitBackend(backend);
  installed = true;
  return backend;
}
