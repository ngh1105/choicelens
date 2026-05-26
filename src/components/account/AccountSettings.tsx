"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, RefreshCw, ShieldCheck } from "lucide-react";
import { BillingPortalButton } from "@/components/account/BillingPortalButton";
import { PrimaryWalletPanel } from "@/components/account/PrimaryWalletPanel";
import { RecoveryEmailForm } from "@/components/account/RecoveryEmailForm";
import type {
  AccountSummary,
  RawAccountSummary,
} from "@/components/account/types";

function formatDate(value: string | null): string {
  if (!value) return "No renewal date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function defaultAccount(): AccountSummary {
  return {
    plan: "free",
    primaryWalletAddress: null,
    recoveryEmail: null,
    stripeSubscriptionStatus: null,
    stripeCurrentPeriodEnd: null,
  };
}

function normalizeAccount(value: RawAccountSummary): AccountSummary {
  return {
    plan: value.effectivePlan ?? value.plan ?? "free",
    primaryWalletAddress: value.primaryWalletAddress ?? null,
    recoveryEmail: value.recoveryEmail ?? null,
    stripeSubscriptionStatus:
      value.stripeSubscriptionStatus ?? value.subscriptionStatus ?? null,
    stripeCurrentPeriodEnd:
      value.stripeCurrentPeriodEnd ?? value.currentPeriodEnd ?? null,
  };
}

export function AccountSettings() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAccount() {
      try {
        const response = await fetch("/api/account", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error("Account summary is not available yet.");
        }
        const body = (await response.json()) as RawAccountSummary;
        if (!cancelled) setAccount(normalizeAccount(body));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setAccount(defaultAccount());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAccount();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeAccount = account ?? defaultAccount();
  const planLabel = useMemo(
    () => activeAccount.plan.charAt(0).toUpperCase() + activeAccount.plan.slice(1),
    [activeAccount.plan],
  );

  return (
    <div className="account-layout">
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Account</span>
          <span className="panel-subtitle">{loading ? "Loading" : "Current state"}</span>
        </div>
        <div className="panel-body account-overview">
          <div className="account-summary-row">
            <span className="account-summary-icon">
              <ShieldCheck size={15} />
            </span>
            <div>
              <p className="account-summary-label">Plan</p>
              <p className="account-summary-value">{planLabel}</p>
            </div>
          </div>
          <div className="account-summary-row">
            <span className="account-summary-icon">
              <RefreshCw size={15} />
            </span>
            <div>
              <p className="account-summary-label">Subscription</p>
              <p className="account-summary-value">
                {activeAccount.stripeSubscriptionStatus ?? "No active subscription"}
              </p>
            </div>
          </div>
          <div className="account-summary-row">
            <span className="account-summary-icon">
              <CalendarClock size={15} />
            </span>
            <div>
              <p className="account-summary-label">Current period</p>
              <p className="account-summary-value">
                {formatDate(activeAccount.stripeCurrentPeriodEnd)}
              </p>
            </div>
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Wallet</span>
          <span className="panel-subtitle">One primary wallet</span>
        </div>
        <div className="panel-body">
          <PrimaryWalletPanel walletAddress={activeAccount.primaryWalletAddress} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Recovery</span>
          <span className="panel-subtitle">Optional</span>
        </div>
        <div className="panel-body">
          <RecoveryEmailForm
            initialEmail={activeAccount.recoveryEmail}
            onSaved={(recoveryEmail) =>
              setAccount((current) => ({
                ...(current ?? defaultAccount()),
                recoveryEmail,
              }))
            }
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Billing</span>
          <span className="panel-subtitle">Stripe portal</span>
        </div>
        <div className="panel-body">
          <BillingPortalButton
            disabled={!activeAccount.stripeSubscriptionStatus}
          />
        </div>
      </section>
    </div>
  );
}
