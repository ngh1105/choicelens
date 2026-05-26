"use client";

import { FormEvent, useState } from "react";
import { ArrowRightLeft, ShieldCheck, Wallet } from "lucide-react";

interface PrimaryWalletPanelProps {
  walletAddress: string | null;
}

interface WalletChangeResponse {
  error?: string;
}

function shorten(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function PrimaryWalletPanel({ walletAddress }: PrimaryWalletPanelProps) {
  const [nextWallet, setNextWallet] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) {
      setError("Confirm that this replaces the current primary wallet.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/account/wallet/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedWalletAddress: nextWallet.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as WalletChangeResponse;
      if (!response.ok) {
        throw new Error(body.error || "Wallet change request is not available yet.");
      }
      setMessage(
        "Wallet change request recorded. Fresh-signature confirmation is required before the primary wallet changes.",
      );
      setNextWallet("");
      setConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-wallet-panel">
      <div className="account-summary-row">
        <span className="account-summary-icon">
          <Wallet size={15} />
        </span>
        <div>
          <p className="account-summary-label">Primary wallet</p>
          <p className="account-summary-value">
            {walletAddress ? shorten(walletAddress) : "No wallet linked"}
          </p>
        </div>
      </div>
      <form className="account-form" onSubmit={requestChange}>
        <label className="field">
          <span className="field-label">Replace primary wallet</span>
          <input
            className="text-input"
            value={nextWallet}
            placeholder="0x..."
            onChange={(event) => setNextWallet(event.currentTarget.value)}
            disabled={!walletAddress || busy}
          />
        </label>
        <label className="wallet-change-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            disabled={!walletAddress || busy}
          />
          <span>
            I understand this replaces the current primary wallet after fresh
            signature confirmation.
          </span>
        </label>
        <button
          className="btn"
          type="submit"
          disabled={!walletAddress || busy || !nextWallet.trim()}
        >
          <ArrowRightLeft size={14} />
          {busy ? "Requesting..." : "Request wallet change"}
        </button>
      </form>
      {!walletAddress ? (
        <p className="section-helper">
          Sign in from pricing to link a wallet before requesting changes.
        </p>
      ) : null}
      {message ? (
        <p className="inline-success">
          <ShieldCheck size={14} />
          {message}
        </p>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}
