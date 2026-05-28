export type AccountPlan = "free" | "plus" | "pro";

export interface AccountSummary {
  plan: AccountPlan;
  primaryWalletAddress: string | null;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: string | null;
  stripeSubscriptionStatus: string | null;
  stripeCurrentPeriodEnd: string | null;
}

export interface RawAccountSummary {
  plan?: AccountPlan;
  effectivePlan?: AccountPlan;
  primaryWalletAddress?: string | null;
  recoveryEmail?: string | null;
  recoveryEmailVerifiedAt?: string | null;
  stripeSubscriptionStatus?: string | null;
  subscriptionStatus?: string | null;
  stripeCurrentPeriodEnd?: string | null;
  currentPeriodEnd?: string | null;
}
