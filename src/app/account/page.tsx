import { AccountSettings } from "@/components/account/AccountSettings";
import { isBillingEnabled } from "@/lib/billing/flag";

export default function AccountPage() {
  const billingEnabled = isBillingEnabled();
  return (
    <main className="billing-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-ok" />
            {billingEnabled ? "Wallet account" : "Free during beta"}
          </p>
          <h1 className="billing-page-title">Account</h1>
        </div>
        <a className="btn btn-ghost" href="/pricing">
          Pricing
        </a>
      </header>
      <AccountSettings billingEnabled={billingEnabled} />
    </main>
  );
}
