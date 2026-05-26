import { AccountSettings } from "@/components/account/AccountSettings";

export default function AccountPage() {
  return (
    <main className="billing-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-ok" />
            Wallet account
          </p>
          <h1 className="billing-page-title">Account</h1>
        </div>
        <a className="btn btn-ghost" href="/pricing">
          Pricing
        </a>
      </header>
      <AccountSettings />
    </main>
  );
}
