export type AnalyticsEventName =
  | "comparison_started"
  | "comparison_completed"
  | "saved_watchlist"
  | "receipt_created"
  | "upgrade_clicked"
  | "recovery_started"
  | "recovery_completed"
  | "result_helpful"
  | "result_unhelpful";

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

interface AnalyticsEvent {
  name: AnalyticsEventName;
  properties?: AnalyticsProperties;
}

function safeProperties(properties?: AnalyticsProperties): AnalyticsProperties | undefined {
  if (!properties) return undefined;
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
}

function emitToConsole(event: AnalyticsEvent): void {
  const properties = safeProperties(event.properties);
  // MVP no-op sink: structured, PII-light event logs for local/prod log drains.
  console.info("[analytics]", JSON.stringify({ name: event.name, properties }));
}

export function trackServerEvent(
  name: AnalyticsEventName,
  properties?: AnalyticsProperties,
): void {
  try {
    emitToConsole({ name, properties });
  } catch {
    // Analytics must never affect product flow.
  }
}

export function trackClientEvent(
  name: AnalyticsEventName,
  properties?: AnalyticsProperties,
): void {
  if (typeof window === "undefined") return;
  try {
    emitToConsole({ name, properties });
  } catch {
    // Analytics must never affect product flow.
  }
}
