export type GenLayerErrorCode =
  | "wallet_not_connected"
  | "wallet_rejected"
  | "wrong_network"
  | "insufficient_funds"
  | "service_account_unavailable"
  | "genlayer_rpc_unavailable"
  | "contract_not_configured"
  | "transaction_timeout"
  | "transaction_failed"
  | "receipt_not_finalized"
  | "contract_schema_mismatch"
  | "unknown_genlayer_error";

export class GenLayerError extends Error {
  readonly code: GenLayerErrorCode;
  constructor(code: GenLayerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = "GenLayerError";
  }
}

export function isGenLayerError(value: unknown): value is GenLayerError {
  return value instanceof GenLayerError;
}

export const HTTP_STATUS_BY_CODE: Record<GenLayerErrorCode, number> = {
  wallet_rejected: 400,
  wallet_not_connected: 400,
  wrong_network: 409,
  contract_schema_mismatch: 409,
  service_account_unavailable: 503,
  genlayer_rpc_unavailable: 503,
  contract_not_configured: 503,
  transaction_timeout: 502,
  transaction_failed: 502,
  receipt_not_finalized: 502,
  insufficient_funds: 500,
  unknown_genlayer_error: 500,
};
