"use client";

import React from "react";
import { trackClientEvent } from "@/lib/analytics";
import type { UsageMetric, UsageSummary } from "./types";

function formatUsage(metric: UsageMetric): string {
  return metric.limit === null ? `${metric.used} / ∞` : `${metric.used} / ${metric.limit}`;
}

export function UsagePanel({
  usage,
  usageError,
}: {
  usage: UsageSummary | null;
  usageError: string | null;
}) {
  if (!usage && !usageError) return null;
  return (
    <div className="panel usage-panel">
      <div className="panel-header">
        <span className="panel-title">Plan usage</span>
        <span className="panel-subtitle">
          {usage ? (usage.plan === "free" ? "Free" : usage.plan) : "Unavailable"}
        </span>
      </div>
      <div className="panel-body">
        {usage ? (
          <>
            <div className="usage-list">
              <UsageRow
                label="Comparisons"
                metric={usage.usage.comparisons}
                resetAt={usage.resetAt}
              />
              <UsageRow label="Watchlist" metric={usage.usage.watchlist} />
              <UsageRow
                label="Receipts"
                metric={usage.usage.receipts}
                resetAt={usage.resetAt}
              />
            </div>
            {(usage.usage.comparisons.blocked ||
              usage.usage.watchlist.blocked ||
              usage.usage.receipts.blocked) ? (
              <p className="section-helper usage-upgrade-note">
                Upgrade to Plus to keep going.
                <a
                  className="inline-upgrade-link"
                  href="/pricing"
                  onClick={() => trackClientEvent("upgrade_clicked", { source: "usage_panel" })}
                >
                  View pricing
                </a>
              </p>
            ) : null}
          </>
        ) : (
          <p className="section-helper">{usageError}</p>
        )}
      </div>
    </div>
  );
}

function UsageRow({
  label,
  metric,
  resetAt,
}: {
  label: string;
  metric: UsageMetric;
  resetAt?: string;
}) {
  return (
    <div className="usage-row" data-blocked={metric.blocked ? "true" : undefined}>
      <div>
        <div className="usage-row-head">
          <span>{label}</span>
          <span className="slider-value">{formatUsage(metric)}</span>
        </div>
        <div className="usage-bar" aria-hidden>
          <span
            className="usage-bar-fill"
            style={{ "--usage-width": `${metric.percent ?? 0}%` } as React.CSSProperties}
          />
        </div>
        {resetAt ? (
          <div className="usage-reset">
            Resets {new Date(resetAt).toLocaleDateString()}
          </div>
        ) : null}
      </div>
    </div>
  );
}


