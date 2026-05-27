export type PlanId = "free" | "plus" | "pro";

export type UsageFeature = "comparisons" | "watchlist" | "receipts";

export interface PlanLimits {
  comparisonsPerMonth: number | null;
  watchlistItems: number | null;
  receiptsPerMonth: number | null;
}

export interface PlanDefinition {
  id: PlanId;
  label: string;
  limits: PlanLimits;
}

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    label: "Free",
    limits: {
      comparisonsPerMonth: 20,
      watchlistItems: 10,
      receiptsPerMonth: 5,
    },
  },
  plus: {
    id: "plus",
    label: "Plus",
    limits: {
      comparisonsPerMonth: null,
      watchlistItems: null,
      receiptsPerMonth: null,
    },
  },
  pro: {
    id: "pro",
    label: "Pro",
    limits: {
      comparisonsPerMonth: null,
      watchlistItems: null,
      receiptsPerMonth: null,
    },
  },
};

const FEATURE_LABELS: Record<UsageFeature, string> = {
  comparisons: "comparisons",
  watchlist: "watchlist items",
  receipts: "receipts",
};

export function resolvePlanId(value: string | null | undefined): PlanId {
  if (value === "plus" || value === "pro") return value;
  return "free";
}

export function getEffectivePlanId(
  storedPlan: string | null | undefined,
  billingEnabled: boolean,
): PlanId {
  if (!billingEnabled) return "plus";
  return resolvePlanId(storedPlan);
}

export function getPlanDefinition(
  value: string | null | undefined,
): PlanDefinition {
  return PLAN_DEFINITIONS[resolvePlanId(value)];
}

export function formatPlanLimitMessage(
  planId: PlanId,
  feature: UsageFeature,
  limit: number,
): string {
  const plan = PLAN_DEFINITIONS[planId];
  return `${plan.label} plan includes ${limit} ${FEATURE_LABELS[feature]}.`;
}
