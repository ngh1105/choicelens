import { WalletRecoveryFlow } from "@/components/auth/WalletRecoveryFlow";

export const dynamic = "force-dynamic";

export default function RecoverPage() {
  return (
    <main className="billing-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-ok" />
            Lost wallet recovery
          </p>
          <h1 className="billing-page-title">Recover your account</h1>
        </div>
        <a className="btn btn-ghost" href="/account">
          Back to account
        </a>
      </header>
      <WalletRecoveryFlow />
    </main>
  );
}
