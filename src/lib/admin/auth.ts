import { createHash, timingSafeEqual } from "crypto";

export type AdminAuthFailure =
  | "admin_token_not_configured"
  | "missing_token"
  | "invalid_token";

export class AdminAuthError extends Error {
  readonly code: AdminAuthFailure;
  constructor(code: AdminAuthFailure, message: string) {
    super(message);
    this.code = code;
    this.name = "AdminAuthError";
  }
}

function hash(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function extractBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : null;
}

export function requireAdminToken(request: Request): void {
  const expected = process.env.ADMIN_API_TOKEN?.trim();
  if (!expected) {
    throw new AdminAuthError(
      "admin_token_not_configured",
      "ADMIN_API_TOKEN is not configured on the server.",
    );
  }
  const provided = extractBearer(request.headers.get("authorization"));
  if (!provided) {
    throw new AdminAuthError("missing_token", "Authorization header missing or malformed.");
  }
  if (!timingSafeEqual(hash(expected), hash(provided))) {
    throw new AdminAuthError("invalid_token", "Bearer token does not match.");
  }
}

export function isAdminAuthError(value: unknown): value is AdminAuthError {
  return value instanceof AdminAuthError;
}
