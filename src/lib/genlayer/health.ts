import { redactAddress, summariseServiceKey } from "./redact";

export type OperatorState =
  | "mock"
  | "kill_switch_active"
  | "contract_not_configured"
  | "studionet_no_service_key"
  | "insufficient_funds"
  | "studionet_unavailable"
  | "studionet_configured"
  | "studionet_idle";

export interface HealthEnv {
  network: string | undefined;
  contractAddress: string | undefined;
  serviceKey: string | undefined;
  rpcUrl: string | undefined;
}

export interface ReceiptSnapshot {
  comparisonId: string;
  status: string;
  network: string;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecentErrorEntry {
  comparisonId: string;
  errorCode: string;
  createdAt: string;
}

export interface OperatorStateSnapshot {
  operatorState: OperatorState;
  network: string;
  contractAddress: string | null;
  contractAddressRedacted: string | null;
  rpcUrlConfigured: boolean;
  serviceKeyPresent: boolean;
  serviceKeyFormatValid: boolean;
  serviceAddress: string | null;
  killSwitchActive: boolean;
  counts24h: {
    submitted: number;
    accepted: number;
    finalized: number;
    finalized_with_error: number;
    off_chain_only: number;
    failed: number;
  };
  recentErrors: RecentErrorEntry[];
  lastSuccessfulAt: string | null;
  checkedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const ERROR_CODES_RPC = new Set(["genlayer_rpc_unavailable", "transaction_timeout"]);

export function computeOperatorState(args: {
  env: HealthEnv;
  recentReceipts: ReceiptSnapshot[];
  hasPriorStudionetReceipt: boolean;
  serviceAddress: string | null;
  now?: Date;
}): OperatorStateSnapshot {
  const { env, recentReceipts, hasPriorStudionetReceipt, serviceAddress } = args;
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS);

  const network = (env.network ?? "mock").trim() || "mock";
  const keySummary = summariseServiceKey(env.serviceKey);
  const contractAddress = env.contractAddress?.trim() || null;
  const rpcUrlConfigured = Boolean(env.rpcUrl?.trim());

  const last24h = recentReceipts.filter((r) => r.createdAt >= since);

  const counts24h = {
    submitted: 0,
    accepted: 0,
    finalized: 0,
    finalized_with_error: 0,
    off_chain_only: 0,
    failed: 0,
  };
  for (const r of last24h) {
    if (r.status in counts24h) {
      counts24h[r.status as keyof typeof counts24h] += 1;
    }
  }

  const recentErrors: RecentErrorEntry[] = last24h
    .filter((r) => r.errorCode)
    .slice(0, 5)
    .map((r) => ({
      comparisonId: r.comparisonId,
      errorCode: r.errorCode as string,
      createdAt: r.createdAt.toISOString(),
    }));

  const lastSuccessfulRow = recentReceipts.find((r) => r.status === "finalized");
  const lastSuccessfulAt = lastSuccessfulRow
    ? lastSuccessfulRow.updatedAt.toISOString()
    : null;

  const killSwitchActive = network === "mock" && hasPriorStudionetReceipt;

  let operatorState: OperatorState;
  if (network !== "studionet") {
    operatorState = killSwitchActive ? "kill_switch_active" : "mock";
  } else if (!contractAddress) {
    operatorState = "contract_not_configured";
  } else if (!keySummary.present || !keySummary.formatValid) {
    operatorState = "studionet_no_service_key";
  } else if (last24h.some((r) => r.errorCode === "insufficient_funds")) {
    operatorState = "insufficient_funds";
  } else if (last24h.some((r) => r.errorCode && ERROR_CODES_RPC.has(r.errorCode))) {
    operatorState = "studionet_unavailable";
  } else if (last24h.some((r) => r.status === "finalized")) {
    operatorState = "studionet_configured";
  } else {
    operatorState = "studionet_idle";
  }

  return {
    operatorState,
    network,
    contractAddress,
    contractAddressRedacted: redactAddress(contractAddress),
    rpcUrlConfigured,
    serviceKeyPresent: keySummary.present,
    serviceKeyFormatValid: keySummary.formatValid,
    serviceAddress,
    killSwitchActive,
    counts24h,
    recentErrors,
    lastSuccessfulAt,
    checkedAt: now.toISOString(),
  };
}

export const OPERATOR_STATE_REMEDIATION: Record<OperatorState, string> = {
  mock: "Off-chain only. No live receipt path. Set GENLAYER_NETWORK=studionet to enable.",
  kill_switch_active:
    "Kill switch active — receipts run off-chain. Confirm intentional rollback (runbook §Rollback).",
  contract_not_configured:
    "Set GENLAYER_CONTRACT_ADDRESS to the operator-owned contract, then restart.",
  studionet_no_service_key:
    "Set GENLAYER_SERVICE_PRIVATE_KEY in the secret manager, then restart.",
  insufficient_funds:
    "Top up the service account on Studionet (runbook §Top-up).",
  studionet_unavailable:
    "RPC issue. Run `npm run genlayer:smoke`. If transient, wait + monitor.",
  studionet_configured: "Healthy.",
  studionet_idle:
    "No traffic in 24h. Run `npm run genlayer:smoke:ephemeral` to confirm reachability.",
};
