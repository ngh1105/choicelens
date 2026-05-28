import Link from "next/link";

export default function HelpPage() {
  return (
    <main className="billing-shell legal-shell">
      <header className="billing-page-header">
        <div>
          <p className="pill">
            <span className="pill-dot dot-ok" /> Help
          </p>
          <h1 className="billing-page-title">How ChoiceLens works</h1>
        </div>
        <Link className="btn btn-primary" href="/">
          Start comparing
        </Link>
      </header>

      <section className="panel">
        <div className="panel-body legal-content">
          <h2>Quick start</h2>
          <ol>
            <li>Describe the choice you are trying to make.</li>
            <li>Add 2-10 options. URLs are optional.</li>
            <li>Adjust priorities and add must-haves or deal-breakers if they matter.</li>
            <li>Run the comparison, then review the recommendation and uncertainty notes.</li>
            <li>Save a top pick or build an optional decision receipt if available on your plan.</li>
          </ol>

          <h2>Good prompts</h2>
          <ul>
            <li>“Pick the best work laptop under $1500 for travel and video calls.”</li>
            <li>“Compare these apartments for a 12-month lease near transit.”</li>
            <li>“Choose a customer support tool for a five-person startup.”</li>
            <li>“Rank these vacation rentals for a quiet family trip.”</li>
          </ul>

          <h2>Wallets and accounts</h2>
          <p>
            You do not need a wallet for the free comparison flow. Connect one
            only if you want account features, beta Plus access, recovery, or
            optional wallet-signed receipts.
          </p>

          <h2>Receipts</h2>
          <p>
            Receipts are optional snapshots of a decision result. They help you
            remember what was compared and why. They are not a guarantee that
            every fact was checked.
          </p>

          <h2>Need support?</h2>
          <p>
            Public support email is not set yet. For this preview, contact the
            person or team that gave you access.
          </p>
        </div>
      </section>
    </main>
  );
}
