"use client";

import { useCallback, useState } from "react";
import { CreditCard } from "lucide-react";

interface PortalResponse {
  url?: string;
  error?: string;
}

export function BillingPortalButton({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as PortalResponse;
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Billing portal is not available yet.");
      }
      window.location.assign(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="account-action-stack">
      <button
        className="btn"
        type="button"
        onClick={openPortal}
        disabled={disabled || busy}
      >
        <CreditCard size={14} />
        {busy ? "Opening..." : "Manage billing"}
      </button>
      {disabled ? (
        <p className="section-helper">Billing portal appears after Plus checkout.</p>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}
