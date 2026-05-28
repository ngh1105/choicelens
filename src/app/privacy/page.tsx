import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="billing-shell legal-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-ok" /> Trust basics
          </p>
          <h1 className="billing-page-title">Privacy</h1>
        </div>
        <Link className="btn btn-ghost" href="/">
          Back to app
        </Link>
      </header>

      <section className="panel">
        <div className="panel-body legal-content">
          <p>
            ChoiceLens is a preview decision tool. This page is plain-language
            product guidance, not a complete legal policy.
          </p>

          <h2>What we store</h2>
          <ul>
            <li>Comparison prompts, option names, optional URLs, priorities, and results.</li>
            <li>Watchlist items you save.</li>
            <li>Plan usage counters so free limits and premium features work.</li>
            <li>Optional wallet address and optional recovery email if you choose to link them.</li>
            <li>Optional decision receipt metadata when you build a receipt.</li>
          </ul>

          <h2>Wallets are optional</h2>
          <p>
            You can use the free comparison flow without connecting a wallet.
            Wallet sign-in is only needed for account features, Plus checkout,
            recovery, or optional wallet-signed receipts when enabled.
          </p>

          <h2>Receipts and GenLayer</h2>
          <p>
            Decision receipts are optional and may be limited by plan. V1 creates
            an off-chain receipt for a hashed scoring snapshot. GenLayer or
            wallet-backed receipt paths are experimental/premium surfaces when
            configured; do not rely on them as legal, financial, or audit advice.
          </p>

          <h2>What not to enter</h2>
          <p>
            Avoid entering secrets, private keys, seed phrases, passwords,
            medical records, or highly sensitive personal data in prompts or
            option notes.
          </p>

          <h2>Contact</h2>
          <p>
            Support contact is not finalized yet. Until a production email is
            published, use the project owner or deployment contact that shared
            this preview with you.
          </p>
        </div>
      </section>
    </main>
  );
}
