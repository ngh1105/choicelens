import { captureException } from "@/lib/observability";

export type LogContext = Record<
  string,
  string | number | boolean | null | undefined
>;

function cleanContext(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  );
}

export function getRequestId(request: Request): string {
  const existing = request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id");
  return existing?.trim() || crypto.randomUUID();
}

export function logRequestError(
  requestId: string,
  message: string,
  err: unknown,
  context?: LogContext,
): void {
  const error = err instanceof Error
    ? { name: err.name, message: err.message }
    : { name: "UnknownError", message: String(err) };
  const cleaned = cleanContext(context);
  console.error(
    "[request_error]",
    JSON.stringify({ requestId, message, error, context: cleaned }),
  );
  captureException(err instanceof Error ? err : new Error(String(err)), {
    requestId,
    message,
    ...(cleaned ?? {}),
  });
}
