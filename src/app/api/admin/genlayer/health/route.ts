import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@/lib/db";
import {
  AdminAuthError,
  isAdminAuthError,
  requireAdminToken,
} from "@/lib/admin/auth";
import {
  computeOperatorState,
  type ReceiptSnapshot,
} from "@/lib/genlayer/health";
import { summariseServiceKey } from "@/lib/genlayer/redact";

export const dynamic = "force-dynamic";

const RECENT_LOOKBACK_DAYS = 2;

function deriveServiceAddress(key: string | undefined): string | null {
  const summary = summariseServiceKey(key);
  if (!summary.present || !summary.formatValid) return null;
  try {
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

function authErrorResponse(err: AdminAuthError): NextResponse {
  if (err.code === "admin_token_not_configured") {
    return NextResponse.json({ error: err.code }, { status: 503 });
  }
  return NextResponse.json({ error: err.code }, { status: 401 });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    requireAdminToken(request);
  } catch (err) {
    if (isAdminAuthError(err)) return authErrorResponse(err);
    throw err;
  }

  const now = new Date();
  const lookbackSince = new Date(
    now.getTime() - RECENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  const [recentRows, priorStudionetCount] = await Promise.all([
    prisma.receipt.findMany({
      where: { createdAt: { gte: lookbackSince } },
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

  const recentReceipts: ReceiptSnapshot[] = recentRows.map((r) => ({
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

  const snapshot = computeOperatorState({
    env,
    recentReceipts,
    hasPriorStudionetReceipt: priorStudionetCount > 0,
    serviceAddress: deriveServiceAddress(env.serviceKey),
    now,
  });

  return NextResponse.json(snapshot);
}
