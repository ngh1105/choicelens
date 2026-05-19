import { Prisma } from "@prisma/client";
import type { ComparisonInput, ComparisonResult } from "./comparison";
import type { DecisionReceipt, ReceiptStatus } from "./genlayer";
import { getDefaultUserId, prisma } from "./db";

export interface ComparisonRecord {
  id: string;
  createdAt: string;
  input: ComparisonInput;
  result: ComparisonResult;
}

export interface WatchlistRecord {
  id: string;
  comparisonId: string;
  optionId: string;
  name: string;
  score: number;
  payloadHash: string;
  addedAt: string;
}

export interface ReceiptRecord extends DecisionReceipt {
  comparisonId: string;
  submitterKind: "service" | "user" | "mock";
  creatorAddress: string | null;
  executionResult: string | null;
  errorCode: string | null;
  updatedAt: string;
}

export class StoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "StoreError";
  }
}

type DbComparison = {
  id: string;
  createdAt: Date;
  input: string;
  result: string;
};

type DbWatchlist = {
  id: string;
  comparisonId: string;
  optionId: string;
  name: string;
  score: number;
  payloadHash: string;
  addedAt: Date;
};

type DbReceipt = {
  id: string;
  comparisonId: string;
  payloadHash: string;
  status: string;
  network: string;
  submitterKind: string;
  creatorAddress: string | null;
  contractAddress: string | null;
  transactionHash: string | null;
  executionResult: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toComparison(row: DbComparison): ComparisonRecord {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    input: JSON.parse(row.input) as ComparisonInput,
    result: JSON.parse(row.result) as ComparisonResult,
  };
}

function toWatchlist(row: DbWatchlist): WatchlistRecord {
  return {
    id: row.id,
    comparisonId: row.comparisonId,
    optionId: row.optionId,
    name: row.name,
    score: row.score,
    payloadHash: row.payloadHash,
    addedAt: row.addedAt.toISOString(),
  };
}

function toReceipt(row: DbReceipt): ReceiptRecord {
  return {
    id: row.id,
    comparisonId: row.comparisonId,
    payloadHash: row.payloadHash,
    status: row.status as ReceiptStatus,
    network: row.network,
    submitterKind: row.submitterKind as "service" | "user" | "mock",
    creatorAddress: row.creatorAddress,
    contractAddress: row.contractAddress,
    transactionHash: row.transactionHash,
    executionResult: row.executionResult,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listComparisons(): Promise<ComparisonRecord[]> {
  const userId = await getDefaultUserId();
  const rows = await prisma.comparison.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toComparison);
}

export async function getComparison(
  id: string,
): Promise<ComparisonRecord | null> {
  const userId = await getDefaultUserId();
  const row = await prisma.comparison.findFirst({ where: { id, userId } });
  return row ? toComparison(row) : null;
}

export async function saveComparison(args: {
  input: ComparisonInput;
  result: ComparisonResult;
}): Promise<ComparisonRecord> {
  const userId = await getDefaultUserId();
  const row = await prisma.comparison.create({
    data: {
      userId,
      input: JSON.stringify(args.input),
      result: JSON.stringify(args.result),
    },
  });
  return toComparison(row);
}

export async function listWatchlist(): Promise<WatchlistRecord[]> {
  const userId = await getDefaultUserId();
  const rows = await prisma.watchlistEntry.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
  return rows.map(toWatchlist);
}

export async function addWatchlistEntry(args: {
  comparisonId: string;
}): Promise<WatchlistRecord> {
  const userId = await getDefaultUserId();
  const comparison = await prisma.comparison.findFirst({
    where: { id: args.comparisonId, userId },
  });
  if (!comparison) {
    throw new StoreError("comparison_not_found", "Comparison not found");
  }
  const result = JSON.parse(comparison.result) as ComparisonResult;
  const top = result.topPick;
  const payloadHash = result.receiptPayloadHash;

  try {
    const row = await prisma.watchlistEntry.create({
      data: {
        userId,
        comparisonId: comparison.id,
        optionId: top.id,
        name: top.name,
        score: top.finalScore,
        payloadHash,
      },
    });
    return toWatchlist(row);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.watchlistEntry.findUnique({
        where: {
          comparisonId_payloadHash: {
            comparisonId: comparison.id,
            payloadHash,
          },
        },
      });
      if (existing) return toWatchlist(existing);
    }
    throw err;
  }
}

export async function removeWatchlistEntry(id: string): Promise<boolean> {
  const userId = await getDefaultUserId();
  const result = await prisma.watchlistEntry.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}

export async function saveReceipt(args: {
  comparisonId: string;
  receipt: DecisionReceipt;
  submitterKind: "service" | "user" | "mock";
  creatorAddress?: string | null;
  executionResult?: string | null;
  errorCode?: string | null;
}): Promise<ReceiptRecord> {
  const userId = await getDefaultUserId();
  const comparison = await prisma.comparison.findFirst({
    where: { id: args.comparisonId, userId },
    select: { id: true },
  });
  if (!comparison) {
    throw new StoreError("comparison_not_found", "Comparison not found");
  }
  const r = args.receipt;
  const creatorAddress = args.creatorAddress ?? null;
  const executionResult = args.executionResult ?? null;
  const errorCode = args.errorCode ?? null;
  const row = await prisma.receipt.upsert({
    where: { comparisonId: comparison.id },
    create: {
      id: r.id,
      comparisonId: comparison.id,
      payloadHash: r.payloadHash,
      status: r.status,
      network: r.network,
      submitterKind: args.submitterKind,
      creatorAddress,
      contractAddress: r.contractAddress,
      transactionHash: r.transactionHash,
      executionResult,
      errorCode,
      createdAt: new Date(r.createdAt),
    },
    update: {
      payloadHash: r.payloadHash,
      status: r.status,
      network: r.network,
      submitterKind: args.submitterKind,
      creatorAddress,
      contractAddress: r.contractAddress,
      transactionHash: r.transactionHash,
      executionResult,
      errorCode,
    },
  });
  return toReceipt(row);
}

export async function getReceiptForComparison(
  comparisonId: string,
): Promise<ReceiptRecord | null> {
  const userId = await getDefaultUserId();
  const comparison = await prisma.comparison.findFirst({
    where: { id: comparisonId, userId },
    select: { id: true },
  });
  if (!comparison) return null;
  const row = await prisma.receipt.findUnique({
    where: { comparisonId: comparison.id },
  });
  return row ? toReceipt(row) : null;
}
