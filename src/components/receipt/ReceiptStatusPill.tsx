import type { ReceiptStatus } from "@/lib/genlayer";

interface PillConfig {
  text: string;
  className: string;
}

const LABELS: Record<ReceiptStatus, PillConfig> = {
  off_chain_only: { text: "Off-chain", className: "receipt-pill receipt-pill-muted" },
  pending: { text: "Pending", className: "receipt-pill receipt-pill-warn" },
  accepted: { text: "Accepted", className: "receipt-pill receipt-pill-info" },
  finalized: { text: "Finalized", className: "receipt-pill receipt-pill-positive" },
  finalized_with_error: { text: "Finalized (error)", className: "receipt-pill receipt-pill-danger" },
  failed: { text: "Failed", className: "receipt-pill receipt-pill-danger" },
};

export function ReceiptStatusPill({ status }: { status: ReceiptStatus }) {
  const cfg = LABELS[status];
  return <span className={cfg.className}>{cfg.text}</span>;
}
