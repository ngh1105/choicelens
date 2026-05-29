type Severity = "info" | "warning" | "error";

type ContextRecord = Record<string, unknown> | undefined;

interface SentryShape {
  captureException?: (err: unknown, ctx?: { extra?: Record<string, unknown> }) => unknown;
  captureMessage?: (msg: string, level?: string) => unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var Sentry: SentryShape | undefined;
  // eslint-disable-next-line no-var
  var __choicelensSentry: SentryShape | undefined;
}

function getSentry(): SentryShape | null {
  return globalThis.__choicelensSentry ?? globalThis.Sentry ?? null;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getDrainUrl(): string | null {
  // Kill switch: lets ops cut outbound log traffic during an incident without a
  // redeploy (e.g. when the drain provider itself is the thing on fire).
  if (isTruthyEnv(process.env.LOG_DRAIN_DISABLED)) return null;
  const url = process.env.LOG_DRAIN_URL;
  if (!url || !/^https?:\/\//.test(url)) return null;
  return url;
}

// Best-effort burst guard. Every 5xx triggers a drain POST, so an error storm
// would otherwise fan out into an outbound-fetch storm (on serverless these are
// tracked until they resolve, even with keepalive). Cap sends per fixed window
// and drop the overflow — the local console.error still holds the full record.
const DRAIN_WINDOW_MS = 60_000;
const DRAIN_MAX_PER_WINDOW = (() => {
  const raw = Number(process.env.LOG_DRAIN_MAX_PER_MINUTE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120;
})();
let drainWindowStart = 0;
let drainSentInWindow = 0;
let drainDroppedInWindow = 0;

function allowDrainSend(): boolean {
  const now = Date.now();
  if (now - drainWindowStart >= DRAIN_WINDOW_MS) {
    if (drainDroppedInWindow > 0) {
      console.warn(
        `[observability] dropped ${drainDroppedInWindow} log-drain send(s) in the last window (cap ${DRAIN_MAX_PER_WINDOW}/min)`,
      );
    }
    drainWindowStart = now;
    drainSentInWindow = 0;
    drainDroppedInWindow = 0;
  }
  if (drainSentInWindow >= DRAIN_MAX_PER_WINDOW) {
    drainDroppedInWindow += 1;
    return false;
  }
  drainSentInWindow += 1;
  return true;
}

async function sendToDrain(payload: Record<string, unknown>): Promise<void> {
  const url = getDrainUrl();
  if (!url) return;
  if (!allowDrainSend()) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // best effort; do not throw from observability path
  }
}

export function captureException(
  err: unknown,
  context?: ContextRecord,
): void {
  const sentry = getSentry();
  if (sentry?.captureException) {
    try {
      sentry.captureException(err, context ? { extra: context } : undefined);
    } catch {
      // swallow Sentry errors
    }
  }
  void sendToDrain({
    // `level` is the standard severity key for Logtail/Axiom/Datadog ingestion.
    level: "error" as Severity,
    timestamp: new Date().toISOString(),
    error: err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : String(err),
    context: context ?? null,
  });
}

export function captureMessage(
  message: string,
  context?: ContextRecord,
  severity: Severity = "info",
): void {
  const sentry = getSentry();
  if (sentry?.captureMessage) {
    try {
      sentry.captureMessage(message, severity);
    } catch {
      // swallow
    }
  }
  void sendToDrain({
    level: severity,
    timestamp: new Date().toISOString(),
    message,
    context: context ?? null,
  });
}
