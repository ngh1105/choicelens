import type { UsageFeature, UsageSummary } from "./types";

export class ApiRequestError extends Error {
  status: number;
  code: string | null;
  feature: UsageFeature | null;

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    feature: UsageFeature | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.feature = feature;
    this.name = "ApiRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const detail = isRecord(payload)
      ? payload.message ?? payload.error
      : null;
    const code = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : null;
    const feature = isRecord(payload) && isUsageFeature(payload.feature)
      ? payload.feature
      : null;
    throw new ApiRequestError(
      response.status,
      typeof detail === "string"
        ? detail
        : `Request failed (${response.status})`,
      code,
      feature,
    );
  }
  return payload as T;
}

export function isUsageFeature(value: unknown): value is UsageFeature {
  return value === "comparisons" || value === "watchlist" || value === "receipts";
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function isUpgradeMessage(message: string | null): boolean {
  return message?.includes("Upgrade to Plus") ?? false;
}

export function planLimitMessage(err: ApiRequestError, fallback: string): string {
  if (err.code !== "plan_limit_reached") return err.message || fallback;
  return `${err.message} Upgrade to Plus to keep going.`;
}

export function localLimitMessage(
  feature: UsageFeature,
  usage: UsageSummary | null,
): string {
  const metric = usage?.usage[feature];
  if (!metric || metric.limit === null) {
    return "This Free plan limit has been reached. Upgrade to Plus to keep going.";
  }
  const nouns: Record<UsageFeature, string> = {
    comparisons: "comparisons",
    watchlist: "watchlist items",
    receipts: "receipts",
  };
  return `Free plan includes ${metric.limit} ${nouns[feature]}. Upgrade to Plus to keep going.`;
}

export function isUsageBlocked(
  usage: UsageSummary | null,
  feature: UsageFeature,
): boolean {
  return usage?.usage[feature].blocked ?? false;
}

