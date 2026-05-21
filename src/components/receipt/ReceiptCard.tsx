"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, RotateCw } from "lucide-react";
import type { ReceiptStatus } from "@/lib/genlayer";
import { ReceiptStatusPill } from "./ReceiptStatusPill";

export interface ReceiptCardData {
  id: string;
  payloadHash: string;
  status: ReceiptStatus;
  network: string;
  contractAddress: string | null;
  transactionHash: string | null;
  createdAt: string;
}

interface ReceiptCardProps {
  receipt: ReceiptCardData;
  pollingError: string | null;
  onRetry?: () => void;
}

const TERMINAL_OK: ReceiptStatus[] = ["finalized", "off_chain_only"];

function explorerUrl(network: string, txHash: string): string | null {
  if (network === "studionet") {
    return `https://studio.genlayer.com/tx/${txHash}`;
  }
  return null;
}

interface CopyButtonProps {
  value: string;
  label: string;
}

function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState<boolean>(false);

  async function handleCopy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures (denied permissions, etc.)
    }
  }

  return (
    <button
      type="button"
      className="receipt-copy"
      onClick={handleCopy}
      data-copied={copied ? "true" : undefined}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function ReceiptCard({ receipt, pollingError, onRetry }: ReceiptCardProps) {
  const explorer = receipt.transactionHash
    ? explorerUrl(receipt.network, receipt.transactionHash)
    : null;
  const isErrorState =
    pollingError !== null ||
    receipt.status === "finalized_with_error" ||
    receipt.status === "failed";

  return (
    <div className="receipt-card">
      <div className="receipt-card-head">
        <ReceiptStatusPill status={receipt.status} />
        <span className="receipt-validity">Off-chain result is valid</span>
      </div>
      <div className="receipt-row">
        <span className="receipt-key">Receipt</span>
        <span className="receipt-val">
          {receipt.id}
          <CopyButton value={receipt.id} label="receipt id" />
        </span>
      </div>
      <div className="receipt-row">
        <span className="receipt-key">Payload</span>
        <span className="receipt-val">
          {receipt.payloadHash}
          <CopyButton value={receipt.payloadHash} label="payload hash" />
        </span>
      </div>
      <div className="receipt-row">
        <span className="receipt-key">Network</span>
        <span className="receipt-val">{receipt.network}</span>
      </div>
      <div className="receipt-row">
        <span className="receipt-key">Tx hash</span>
        <span className="receipt-val">
          {receipt.transactionHash ?? "-"}
          {receipt.transactionHash ? (
            <CopyButton value={receipt.transactionHash} label="transaction hash" />
          ) : null}
          {explorer ? (
            <a
              className="receipt-link"
              href={explorer}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="View on explorer"
            >
              <ExternalLink size={12} />
            </a>
          ) : null}
        </span>
      </div>
      <div className="receipt-row">
        <span className="receipt-key">Created</span>
        <span className="receipt-val">
          {new Date(receipt.createdAt).toLocaleString()}
        </span>
      </div>
      {pollingError ? (
        <div className="receipt-error">
          <span>
            {pollingError === "transaction_timeout"
              ? "Status update took too long. The off-chain result is still valid."
              : "Could not refresh status. The off-chain result is still valid."}
          </span>
          {onRetry ? (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={onRetry}
            >
              <RotateCw size={12} />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {!isErrorState && !TERMINAL_OK.includes(receipt.status) ? (
        <div className="section-helper">
          Anchoring on-chain. Result remains usable while we wait.
        </div>
      ) : null}
    </div>
  );
}
