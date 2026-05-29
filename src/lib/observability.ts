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

function getDrainUrl(): string | null {
  const url = process.env.LOG_DRAIN_URL;
  if (!url || !/^https?:\/\//.test(url)) return null;
  return url;
}

async function sendToDrain(payload: Record<string, unknown>): Promise<void> {
  const url = getDrainUrl();
  if (!url) return;
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
    severity: "error" as Severity,
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
    severity,
    timestamp: new Date().toISOString(),
    message,
    context: context ?? null,
  });
}
