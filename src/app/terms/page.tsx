import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="billing-shell legal-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-warn" /> Preview terms
          </p>
          <h1 className="billing-page-title">Terms</h1>
        </div>
        <Link className="btn btn-ghost" href="/">
          Back to app
        </Link>
      </header>

      <section className="panel">
        <div className="panel-body legal-content">
          <p>
            ChoiceLens is provided as a preview tool for comparing options and
            organizing decision evidence. These MVP terms are intentionally
            simple and should be replaced with reviewed legal terms before a
            broad public launch.
          </p>

          <h2>Use your own judgment</h2>
          <p>
            Recommendations, scores, and confidence signals are informational.
            They are not professional, legal, investment, medical, or financial
            advice. You are responsible for checking important facts before you
            act.
          </p>

          <h2>Free and paid features</h2>
          <p>
            The free flow lets visitors run comparisons without wallet setup.
            Plus or other premium flows may increase limits, unlock account
            features, or enable optional receipts. Pricing, limits, and beta
            access may change while the product is in preview.
          </p>

          <h2>Wallet and receipt features</h2>
          <p>
            Wallet linking is optional unless you choose account, checkout, or
            wallet-signed receipt features. Decision receipts and GenLayer paths
            are optional and experimental. A receipt records a hashed snapshot;
            it does not prove that the underlying source data was complete or
            correct.
          </p>

          <h2>Acceptable use</h2>
          <ul>
            <li>Do not submit illegal content or content you do not have rights to use.</li>
            <li>Do not attempt to bypass usage limits or interfere with service operation.</li>
            <li>Do not enter seed phrases, private keys, passwords, or other secrets.</li>
          </ul>

          <h2>Contact</h2>
          <p>
            Support contact is a placeholder for now. Use the project owner or
            deployment contact that shared this preview with you until an
            official address is published.
          </p>
        </div>
      </section>
    </main>
  );
}
