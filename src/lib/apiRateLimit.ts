import { NextResponse } from "next/server";
import {
  checkInMemoryRateLimit,
  type InMemoryRateLimitOptions,
} from "@/lib/rateLimit";

export interface ApiRateLimitOptions {
  /** Stable bucket name, e.g. "comparisons:create". */
  scope: string;
  /** Max requests inside windowMs. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /**
   * Optional caller identifier appended to the key (e.g. visitor/user id).
   * Defaults to `ip:<x-forwarded-for>` only.
   */
  identifier?: string;
}

export interface ApiRateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function buildKey(request: Request, options: ApiRateLimitOptions): string {
  const ip = clientIp(request);
  const id = options.identifier ?? "anon";
  return `${options.scope}:${ip}:${id}`;
}

export type RateLimitBackend = (
  options: InMemoryRateLimitOptions,
) => Promise<{ limited: boolean; remaining: number; resetAt: number }> | {
  limited: boolean;
  remaining: number;
  resetAt: number;
};

let backend: RateLimitBackend = checkInMemoryRateLimit;
let bootstrapAttempted = false;

async function maybeBootstrap(): Promise<void> {
  if (bootstrapAttempted) return;
  bootstrapAttempted = true;
  // Defer the import so test code that overrides the backend before the first
  // call is not racing with this side-effect import.
  try {
    const mod = await import("@/lib/rateLimit.bootstrap");
    mod.ensureSharedRateLimitBackend();
  } catch {
    // best effort; bootstrap is optional
  }
}

export function setRateLimitBackend(next: RateLimitBackend): void {
  bootstrapAttempted = true;
  backend = next;
}

export function resetRateLimitBackend(): void {
  bootstrapAttempted = false;
  backend = checkInMemoryRateLimit;
}

export async function applyApiRateLimit(
  request: Request,
  options: ApiRateLimitOptions,
): Promise<ApiRateLimitResult> {
  await maybeBootstrap();
  let result: { limited: boolean; remaining: number; resetAt: number };
  try {
    result = await backend({
      key: buildKey(request, options),
      limit: options.limit,
      windowMs: options.windowMs,
    });
  } catch (err) {
    // Fail open: rate limiting is defense in depth, not a critical path. If the
    // backend (e.g. Upstash REST) times out or 5xxs, never block the request —
    // this matters most for auth/recovery flows, where a degraded Redis/log
    // drain must not lock users out.
    console.warn(
      `[apiRateLimit] backend failed for scope "${options.scope}"; failing open`,
      err,
    );
    return {
      limited: false,
      remaining: options.limit,
      resetAt: Date.now() + options.windowMs,
      retryAfterSec: 0,
    };
  }
  const retryAfterSec = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000),
  );
  return {
    limited: result.limited,
    remaining: result.remaining,
    resetAt: result.resetAt,
    retryAfterSec,
  };
}

export interface RateLimitedResponseInit {
  result: ApiRateLimitResult;
  errorCode?: string;
  message?: string;
  requestId?: string;
}

export function rateLimitedResponse({
  result,
  errorCode = "rate_limited",
  message,
  requestId,
}: RateLimitedResponseInit): NextResponse {
  const body: Record<string, unknown> = {
    error: errorCode,
    retryAfter: result.retryAfterSec,
  };
  if (message) body.message = message;
  if (requestId) body.requestId = requestId;
  const response = NextResponse.json(body, { status: 429 });
  response.headers.set("Retry-After", String(result.retryAfterSec));
  response.headers.set("X-RateLimit-Limit", String(result.remaining + 1));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(result.resetAt / 1000)),
  );
  return response;
}
