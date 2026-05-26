"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Check, CircleSlash, Sparkles } from "lucide-react";
import { WalletSignInPrompt } from "@/components/auth/WalletSignInPrompt";

interface CheckoutResponse {
  url?: string;
  error?: string;
}

const freeFeatures = [
  "Core comparison workflow",
  "Watchlist and receipt previews",
  "Visitor identity, no wallet required",
];

const plusFeatures = [
  "No monthly caps on core comparison actions",
  "Wallet-linked paid identity",
  "Stripe billing portal access",
];

const proFeatures = [
  "Not self-serve yet",
  "Reserved for bulk/team workflows later",
  "Team and catalog workflows planned",
];

export function PricingPlans() {
  const [sessionReady, setSessionReady] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const startCheckout = useCallback(async () => {
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "plus" }),
      });
      const body = (await response.json().catch(() => ({}))) as CheckoutResponse;
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Plus checkout is not available yet.");
      }
      window.location.assign(body.url);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckoutBusy(false);
    }
  }, []);

  return (
    <div className="pricing-grid">
      <section className="pricing-plan panel">
        <div className="panel-header">
          <span className="panel-title">Free</span>
          <span className="panel-subtitle">$0</span>
        </div>
        <div className="panel-body pricing-plan-body">
          <p className="pricing-plan-price">$0/mo</p>
          <p className="section-helper">Start comparing without wallet onboarding.</p>
          <FeatureList features={freeFeatures} />
          <Link className="btn btn-ghost pricing-plan-action" href="/">
            Open app
          </Link>
        </div>
      </section>

      <section className="pricing-plan pricing-plan-featured panel">
        <div className="panel-header">
          <span className="panel-title">
            <Sparkles size={14} />
            Plus
          </span>
          <span className="receipt-pill receipt-pill-info">Beta</span>
        </div>
        <div className="panel-body pricing-plan-body">
          <div>
            <p className="pricing-plan-price">$12/mo</p>
            <p className="section-helper">Billed monthly</p>
          </div>
          <FeatureList features={plusFeatures} />
          <WalletSignInPrompt onSessionReady={() => setSessionReady(true)} />
          <button
            className="btn btn-primary pricing-plan-action"
            type="button"
            onClick={startCheckout}
            disabled={!sessionReady || checkoutBusy}
          >
            {checkoutBusy ? "Opening..." : "Upgrade to Plus"}
            <ArrowRight size={14} />
          </button>
          {checkoutError ? <p className="inline-error">{checkoutError}</p> : null}
        </div>
      </section>

      <section className="pricing-plan panel">
        <div className="panel-header">
          <span className="panel-title">
            <Building2 size={14} />
            Pro
          </span>
          <span className="panel-subtitle">Catalog only</span>
        </div>
        <div className="panel-body pricing-plan-body">
          <p className="pricing-plan-price">Catalog only</p>
          <p className="section-helper">Reserved for bulk/team workflows later.</p>
          <FeatureList features={proFeatures} />
          <button className="btn btn-disabled pricing-plan-action" type="button" disabled>
            <CircleSlash size={14} />
            Not self-serve yet
          </button>
        </div>
      </section>
    </div>
  );
}

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="pricing-feature-list">
      {features.map((feature) => (
        <li key={feature}>
          <Check size={14} />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
