import { PricingPlans } from "@/components/billing/PricingPlans";
import { isBillingEnabled } from "@/lib/billing/flag";

export default function PricingPage() {
  const billingEnabled = isBillingEnabled();
  return (
    <main className="billing-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-ok" />
            {billingEnabled ? "Billing beta" : "Free during beta"}
          </p>
          <h1 className="billing-page-title">Pricing</h1>
        </div>
        <a className="btn btn-ghost" href="/account">
          Account
        </a>
      </header>
      <PricingPlans billingEnabled={billingEnabled} />
    </main>
  );
}
