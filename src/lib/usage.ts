import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { isBillingEnabled } from "./billing/flag";
import {
  formatPlanLimitMessage,
  getPlanDefinition,
  type PlanId,
  type UsageFeature,
} from "./plans";
import type { ComparisonResult } from "./comparison";

export type { UsageFeature } from "./plans";

export interface UsageMetric {
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
  blocked: boolean;
}

export interface UsageSummary {
  plan: PlanId;
  resetAt: string;
  usage: Record<UsageFeature, UsageMetric>;
}

export interface PlanLimitPayload {
  error: "plan_limit_reached";
  feature: UsageFeature;
  message: string;
  usage: UsageMetric;
  resetAt: string;
}

export interface UsageUser {
  id: string;
  plan: string;
}

export class PlanLimitError extends Error {
  feature: UsageFeature;
  usage: UsageMetric;
  resetAt: string;

  constructor(args: {
    feature: UsageFeature;
    message: string;
    usage: UsageMetric;
    resetAt: string;
  }) {
    super(args.message);
    this.name = "PlanLimitError";
    this.feature = args.feature;
    this.usage = args.usage;
    this.resetAt = args.resetAt;
  }
}

function utcMonthWindow(now: Date): { start: Date; reset: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, reset };
}

function metric(used: number, limit: number | null): UsageMetric {
  if (limit === null) {
    return {
      used,
      limit,
      remaining: null,
      percent: null,
      blocked: false,
    };
  }
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    percent: limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100)),
    blocked: remaining <= 0,
  };
}

export function planLimitPayload(error: PlanLimitError): PlanLimitPayload {
  return {
    error: "plan_limit_reached",
    feature: error.feature,
    message: error.message,
    usage: error.usage,
    resetAt: error.resetAt,
  };
}

export async function getUsageSummaryForUser(
  client: Prisma.TransactionClient | typeof prisma,
  user: UsageUser,
  now = new Date(),
): Promise<UsageSummary> {
  const plan = getPlanDefinition(isBillingEnabled() ? user.plan : "plus");
  const { start, reset } = utcMonthWindow(now);
  const [comparisons, watchlist, receipts] = await Promise.all([
    client.comparison.count({
      where: {
        userId: user.id,
        createdAt: { gte: start, lt: reset },
      },
    }),
    client.watchlistEntry.count({
      where: { userId: user.id },
    }),
    client.receipt.count({
      where: {
        createdAt: { gte: start, lt: reset },
        comparison: { userId: user.id },
      },
    }),
  ]);

  return {
    plan: plan.id,
    resetAt: reset.toISOString(),
    usage: {
      comparisons: metric(comparisons, plan.limits.comparisonsPerMonth),
      watchlist: metric(watchlist, plan.limits.watchlistItems),
      receipts: metric(receipts, plan.limits.receiptsPerMonth),
    },
  };
}

export async function getUsageSummary(
  user: UsageUser,
  now = new Date(),
): Promise<UsageSummary> {
  return getUsageSummaryForUser(prisma, user, now);
}

export async function assertWithinPlanLimit(
  user: UsageUser,
  feature: UsageFeature,
  now = new Date(),
): Promise<void> {
  const summary = await getUsageSummary(user, now);
  const usage = summary.usage[feature];
  if (!usage.blocked || usage.limit === null) return;

  throw new PlanLimitError({
    feature,
    message: formatPlanLimitMessage(summary.plan, feature, usage.limit),
    usage,
    resetAt: summary.resetAt,
  });
}

export async function assertWithinPlanLimitForUser(
  client: Prisma.TransactionClient | typeof prisma,
  user: UsageUser,
  feature: UsageFeature,
  now = new Date(),
): Promise<void> {
  const summary = await getUsageSummaryForUser(client, user, now);
  const usage = summary.usage[feature];
  if (!usage.blocked || usage.limit === null) return;

  throw new PlanLimitError({
    feature,
    message: formatPlanLimitMessage(summary.plan, feature, usage.limit),
    usage,
    resetAt: summary.resetAt,
  });
}

export async function getExistingWatchlistEntryForComparison(
  userId: string,
  comparisonId: string,
) {
  const comparison = await prisma.comparison.findFirst({
    where: { id: comparisonId, userId },
    select: { result: true },
  });
  if (!comparison) return null;
  const result = JSON.parse(comparison.result) as ComparisonResult;
  return prisma.watchlistEntry.findUnique({
    where: {
      comparisonId_payloadHash: {
        comparisonId,
        payloadHash: result.receiptPayloadHash,
      },
    },
  });
}

export async function hasReceiptForComparison(
  userId: string,
  comparisonId: string,
): Promise<boolean> {
  const receipt = await prisma.receipt.findFirst({
    where: {
      comparisonId,
      comparison: { userId },
    },
    select: { id: true },
  });
  return receipt !== null;
}
