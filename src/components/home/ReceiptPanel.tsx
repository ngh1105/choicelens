"use client";

import { useState } from "react";
import { FileSignature } from "lucide-react";
import type { ComparisonResult } from "@/lib/comparison";
import { isGenLayerWalletPathConfigured, isWalletConfigured } from "@/lib/wallet";
import { ReceiptCard } from "@/components/receipt/ReceiptCard";
import { WalletReceiptControls } from "@/components/receipt/WalletReceiptControls";
import { trackClientEvent } from "@/lib/analytics";
import type { ReceiptRecord } from "./types";

interface ReceiptPanelProps {
  result: ComparisonResult | null;
  receipt: ReceiptRecord | null;
  comparisonId: string | null;
  onBuild: () => void;
  canBuild: boolean;
  isBuilding: boolean;
  pollingError: string | null;
  onRetry: () => void;
  onWalletReceipt: (receipt: ReceiptRecord) => void;
  onWalletError: (message: string) => void;
  usageBlocked: boolean;
}

export function ReceiptPanel({
  result,
  receipt,
  comparisonId,
  onBuild,
  canBuild,
  isBuilding,
  pollingError,
  onRetry,
  onWalletReceipt,
  onWalletError,
  usageBlocked,
}: ReceiptPanelProps) {
  const [walletBusy, setWalletBusy] = useState<boolean>(false);
  const showWalletControls = isWalletConfigured && isGenLayerWalletPathConfigured;
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Decision receipt</span>
        <span className="panel-subtitle">Optional, premium-friendly snapshot</span>
      </div>
      <div className="panel-body panel-stack">
        <div className="section-helper">
          Receipts save a hashed snapshot of the scoring result so you can revisit
          what was compared later. They are optional, may count against plan
          limits, and are separate from the free comparison flow.
        </div>
        <div className="row-actions">
          <button
            className="btn"
            type="button"
            onClick={onBuild}
            disabled={!result || !canBuild || isBuilding || walletBusy || usageBlocked}
            title={usageBlocked ? "Free receipt limit reached" : undefined}
          >
            <FileSignature size={14} />
            {usageBlocked
              ? "Receipt limit"
              : isBuilding
              ? "Building..."
              : "Build receipt"}
          </button>
        </div>
        {usageBlocked ? (
          <div className="section-helper">
            Free receipt limit reached. Upgrade to Plus to keep going.
            <a
              className="inline-upgrade-link"
              href="/pricing"
              onClick={() => trackClientEvent("upgrade_clicked", { source: "receipt_limit" })}
            >
              View pricing
            </a>
          </div>
        ) : null}
        {showWalletControls ? (
          <WalletReceiptControls
            comparisonId={comparisonId}
            disabled={!result || !canBuild || isBuilding || usageBlocked}
            onSubmitting={setWalletBusy}
            onSubmitted={(record) => onWalletReceipt(record as ReceiptRecord)}
            onError={onWalletError}
          />
        ) : null}
        {receipt ? (
          <ReceiptCard
            receipt={receipt}
            pollingError={pollingError}
            onRetry={onRetry}
          />
        ) : null}
      </div>
    </div>
  );


}
