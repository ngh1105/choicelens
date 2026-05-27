/**
 * V2 monetization beta is gated by the BILLING_ENABLED env var so we can
 * temporarily run the product as full-Free without ripping out the Stripe code.
 *
 * Default: enabled (preserves the original V2 behavior). Set
 * `BILLING_ENABLED=false` (also accepts `0` or `off`) to:
 *
 * - Treat every user as effective-Plus for usage caps and account summary.
 * - Reject /api/billing/* with 503 billing_disabled.
 * - Render the "Free during beta" copy on /pricing and hide Billing on /account.
 *
 * Re-enable by removing the env var or setting BILLING_ENABLED=true.
 */
export function isBillingEnabled(): boolean {
  const value = process.env.BILLING_ENABLED?.trim().toLowerCase();
  if (value === "false" || value === "0" || value === "off") return false;
  return true;
}
