import { PricingPlans } from "@/components/billing/PricingPlans";

export default function PricingPage() {
  return (
    <main className="billing-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-ok" />
            Billing beta
          </p>
          <h1 className="billing-page-title">Pricing</h1>
        </div>
        <a className="btn btn-ghost" href="/account">
          Account
        </a>
      </header>
      <PricingPlans />
    </main>
  );
}
