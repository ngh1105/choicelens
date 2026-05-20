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

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "32px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="field-label">GenLayer ops</span>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          Operator health
        </h1>
        <p className="section-helper">
          Read-only. No secrets. Updated{" "}
          {new Date(snapshot.checkedAt).toLocaleString()}.
        </p>
      </header>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Operator state</span>
          <span className={`receipt-pill ${TONE_CLASS[pill.tone]}`}>
            {pill.label}
          </span>
        </div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
            {snapshot.operatorState}
          </code>
          <p style={{ margin: 0, color: "var(--text-soft)" }}>{remediation}</p>
          {snapshot.killSwitchActive ? (
            <p
              className="receipt-error"
              style={{ marginTop: 4 }}
              role="status"
            >
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
          <dl
            style={{
              margin: 0,
              display: "grid",
              gridTemplateColumns: "max-content minmax(0, 1fr)",
              gap: "8px 16px",
              fontSize: 13,
            }}
          >
            <dt style={{ color: "var(--text-muted)" }}>Network</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--text-soft)",
              }}
            >
              {snapshot.network}
            </dd>
            <dt style={{ color: "var(--text-muted)" }}>Contract</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--text-soft)",
              }}
            >
              {snapshot.contractAddressRedacted ?? "—"}
            </dd>
            <dt style={{ color: "var(--text-muted)" }}>Service key</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: snapshot.serviceKeyPresent && !snapshot.serviceKeyFormatValid
                  ? "var(--danger)"
                  : "var(--text-soft)",
              }}
            >
              {snapshot.serviceKeyPresent
                ? snapshot.serviceKeyFormatValid
                  ? "present (format ok)"
                  : "present (BAD FORMAT)"
                : "missing"}
            </dd>
            <dt style={{ color: "var(--text-muted)" }}>Service address</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--text-soft)",
                wordBreak: "break-all",
              }}
            >
              {snapshot.serviceAddress ?? "—"}
            </dd>
            <dt style={{ color: "var(--text-muted)" }}>RPC URL</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--text-soft)",
              }}
            >
              {snapshot.rpcUrlConfigured ? "configured" : "missing"}
            </dd>
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
          <dl
            style={{
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 12,
            }}
          >
            {counts.map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <dt
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {label}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: 18,
                    fontWeight: 600,
                  }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Recent errors (last 5, 24h)</span>
        </div>
        <div className="panel-body">
          {snapshot.recentErrors.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
              None.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {snapshot.recentErrors.map((e) => (
                <li
                  key={`${e.comparisonId}-${e.createdAt}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto auto",
                    gap: 12,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text-soft)",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.comparisonId}
                  </span>
                  <span style={{ color: "var(--danger)" }}>{e.errorCode}</span>
                  <span style={{ color: "var(--text-muted)" }}>
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
