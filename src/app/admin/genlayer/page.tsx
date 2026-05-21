import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@/lib/db";
import {
  computeOperatorState,
  OPERATOR_STATE_REMEDIATION,
  type OperatorState,
  type ReceiptSnapshot,
} from "@/lib/genlayer/health";
import { summariseServiceKey } from "@/lib/genlayer/redact";

export const dynamic = "force-dynamic";

type Tone = "ok" | "warn" | "danger";

const STATE_PILL: Record<OperatorState, { label: string; tone: Tone }> = {
  studionet_configured: { label: "Healthy", tone: "ok" },
  studionet_idle: { label: "Idle", tone: "warn" },
  mock: { label: "Mock", tone: "warn" },
  kill_switch_active: { label: "Kill switch active", tone: "warn" },
  studionet_unavailable: { label: "Studionet unavailable", tone: "danger" },
  insufficient_funds: { label: "Insufficient funds", tone: "danger" },
  studionet_no_service_key: { label: "Service key missing", tone: "danger" },
  contract_not_configured: { label: "Contract not configured", tone: "danger" },
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "receipt-pill-positive",
  warn: "receipt-pill-warn",
  danger: "receipt-pill-danger",
};

const COUNT_TONE: Record<string, Tone | "neutral"> = {
  finalized: "ok",
  finalized_with_error: "warn",
  failed: "danger",
  submitted: "neutral",
  accepted: "neutral",
  off_chain_only: "neutral",
};

function deriveServiceAddress(key: string | undefined): string | null {
  const summary = summariseServiceKey(key);
  if (!summary.present || !summary.formatValid) return null;
  try {
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

async function loadSnapshot() {
  const now = new Date();
  const since = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const [rows, priorCount] = await Promise.all([
    prisma.receipt.findMany({
      where: { createdAt: { gte: since } },
      select: {
        comparisonId: true,
        status: true,
        network: true,
        errorCode: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.receipt.count({ where: { network: "studionet" } }),
  ]);
  const recentReceipts: ReceiptSnapshot[] = rows.map((r) => ({
    comparisonId: r.comparisonId,
    status: r.status,
    network: r.network,
    errorCode: r.errorCode,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  const env = {
    network: process.env.GENLAYER_NETWORK,
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS,
    serviceKey: process.env.GENLAYER_SERVICE_PRIVATE_KEY,
    rpcUrl: process.env.GENLAYER_RPC_URL,
  };
  return computeOperatorState({
    env,
    recentReceipts,
    hasPriorStudionetReceipt: priorCount > 0,
    serviceAddress: deriveServiceAddress(env.serviceKey),
    now,
  });
}

export default async function GenLayerAdminPage() {
  const snapshot = await loadSnapshot();
  const pill = STATE_PILL[snapshot.operatorState];
  const remediation = OPERATOR_STATE_REMEDIATION[snapshot.operatorState];

  const counts: Array<[string, number]> = [
    ["submitted", snapshot.counts24h.submitted],
    ["accepted", snapshot.counts24h.accepted],
    ["finalized", snapshot.counts24h.finalized],
    ["finalized_with_error", snapshot.counts24h.finalized_with_error],
    ["off_chain_only", snapshot.counts24h.off_chain_only],
    ["failed", snapshot.counts24h.failed],
  ];

  const serviceKeyClass =
    snapshot.serviceKeyPresent && !snapshot.serviceKeyFormatValid
      ? "is-bad"
      : "";
  const serviceKeyText = snapshot.serviceKeyPresent
    ? snapshot.serviceKeyFormatValid
      ? "present (format ok)"
      : "present (BAD FORMAT)"
    : "missing";

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <span className="field-label">GenLayer ops</span>
        <h1 className="admin-h1">Operator health</h1>
        <p className="section-helper">
          Read-only. No secrets. Updated{" "}
          {new Date(snapshot.checkedAt).toLocaleString()}.
        </p>
      </header>

      <section className="panel">
        <div className={`admin-state-strip tone-${pill.tone}`} />
        <div className="panel-header">
          <span className="panel-title">Operator state</span>
          <span className={`receipt-pill ${TONE_CLASS[pill.tone]}`}>
            {pill.label}
          </span>
        </div>
        <div className="panel-body admin-panel-body-stack">
          <code className="admin-state-code">{snapshot.operatorState}</code>
          <p className="admin-state-text">{remediation}</p>
          {snapshot.killSwitchActive ? (
            <p className="receipt-error" role="status">
              <span>Kill switch active — receipts run off-chain.</span>
            </p>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Configuration</span>
        </div>
        <div className="panel-body">
          <dl className="admin-config-grid">
            <dt>Network</dt>
            <dd>{snapshot.network}</dd>
            <dt>Contract</dt>
            <dd>{snapshot.contractAddressRedacted ?? "—"}</dd>
            <dt>Service key</dt>
            <dd className={serviceKeyClass}>{serviceKeyText}</dd>
            <dt>Service address</dt>
            <dd>{snapshot.serviceAddress ?? "—"}</dd>
            <dt>RPC URL</dt>
            <dd>{snapshot.rpcUrlConfigured ? "configured" : "missing"}</dd>
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Receipts (last 24h)</span>
          <span className="panel-subtitle">
            Last finalized:{" "}
            {snapshot.lastSuccessfulAt
              ? new Date(snapshot.lastSuccessfulAt).toLocaleString()
              : "—"}
          </span>
        </div>
        <div className="panel-body">
          <dl className="admin-counts-grid">
            {counts.map(([label, value]) => {
              const tone = COUNT_TONE[label] ?? "neutral";
              const toneClass = tone === "neutral" ? "" : `tone-${tone}`;
              return (
                <div
                  key={label}
                  className={`admin-count-tile ${toneClass}`.trim()}
                >
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Recent errors (last 5, 24h)</span>
        </div>
        <div className="panel-body">
          {snapshot.recentErrors.length === 0 ? (
            <p className="admin-errors-empty">None.</p>
          ) : (
            <ul className="admin-errors-list">
              {snapshot.recentErrors.map((e) => (
                <li
                  key={`${e.comparisonId}-${e.createdAt}`}
                  className="admin-errors-row"
                >
                  <span className="err-id">{e.comparisonId}</span>
                  <span className="err-code">{e.errorCode}</span>
                  <span className="err-time">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
