import { Prisma } from "@prisma/client";
import type { ComparisonInput, ComparisonResult } from "./comparison";
import type { DecisionReceipt, ReceiptStatus } from "./genlayer";
import { prisma } from "./db";
import { assertWithinPlanLimitForUser } from "./usage";

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

export interface ComparisonFeedbackRecord {
  id: string;
  comparisonId: string;
  helpful: boolean;
  createdAt: string;
}

export class StoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "StoreError";
  }
}

function isSerializationConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2034"
  );
}

async function serializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (!isSerializationConflict(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
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

type DbComparisonFeedback = {
  id: string;
  comparisonId: string;
  helpful: boolean;
  createdAt: Date;
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

function toComparisonFeedback(
  row: DbComparisonFeedback,
): ComparisonFeedbackRecord {
  return {
    id: row.id,
    comparisonId: row.comparisonId,
    helpful: row.helpful,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listComparisons(
  userId: string,
): Promise<ComparisonRecord[]> {
  const rows = await prisma.comparison.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toComparison);
}

export async function getComparison(
  userId: string,
  id: string,
): Promise<ComparisonRecord | null> {
  const row = await prisma.comparison.findFirst({ where: { id, userId } });
  return row ? toComparison(row) : null;
}

export async function saveComparison(
  userId: string,
  args: {
    input: ComparisonInput;
    result: ComparisonResult;
  },
): Promise<ComparisonRecord> {
  const row = await serializable(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, plan: true },
    });
    await assertWithinPlanLimitForUser(tx, user, "comparisons");
    return tx.comparison.create({
      data: {
        userId,
        input: JSON.stringify(args.input),
        result: JSON.stringify(args.result),
      },
    });
  });
  return toComparison(row);
}

export async function listWatchlist(userId: string): Promise<WatchlistRecord[]> {
  const rows = await prisma.watchlistEntry.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
  return rows.map(toWatchlist);
}

export async function addWatchlistEntry(
  userId: string,
  args: {
    comparisonId: string;
  },
): Promise<WatchlistRecord> {
  const row = await serializable(async (tx) => {
    const comparison = await tx.comparison.findFirst({
      where: { id: args.comparisonId, userId },
    });
    if (!comparison) {
      throw new StoreError("comparison_not_found", "Comparison not found");
    }
    const result = JSON.parse(comparison.result) as ComparisonResult;
    const top = result.topPick;
    const payloadHash = result.receiptPayloadHash;
    const existing = await tx.watchlistEntry.findUnique({
      where: {
        comparisonId_payloadHash: {
          comparisonId: comparison.id,
          payloadHash,
        },
      },
    });
    if (existing) return existing;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, plan: true },
    });
    await assertWithinPlanLimitForUser(tx, user, "watchlist");
    return tx.watchlistEntry.create({
      data: {
        userId,
        comparisonId: comparison.id,
        optionId: top.id,
        name: top.name,
        score: top.finalScore,
        payloadHash,
      },
    });
  });
  return toWatchlist(row);
}

export async function removeWatchlistEntry(
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await prisma.watchlistEntry.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}

export async function saveComparisonFeedback(
  userId: string,
  args: {
    comparisonId: string;
    helpful: boolean;
  }
): Promise<ComparisonFeedbackRecord> {
  const row = await serializable(async (tx) => {
    const comparison = await tx.comparison.findFirst({
      where: { id: args.comparisonId, userId },
      select: { id: true },
    });
    if (!comparison) {
      throw new StoreError("comparison_not_found", "Comparison not found");
    }
    return tx.comparisonFeedback.create({
      data: {
        comparisonId: comparison.id,
        userId,
        helpful: args.helpful,
      },
    });
  });
  return toComparisonFeedback(row);
}

export async function saveReceipt(
  userId: string,
  args: {
    comparisonId: string;
    receipt: DecisionReceipt;
    submitterKind: "service" | "user" | "mock";
    creatorAddress?: string | null;
    executionResult?: string | null;
    errorCode?: string | null;
  }
): Promise<ReceiptRecord> {
  const r = args.receipt;
  const creatorAddress = args.creatorAddress ?? null;
  const executionResult = args.executionResult ?? null;
  const errorCode = args.errorCode ?? null;
  const row = await serializable(async (tx) => {
    const comparison = await tx.comparison.findFirst({
      where: { id: args.comparisonId, userId },
      select: { id: true },
    });
    if (!comparison) {
      throw new StoreError("comparison_not_found", "Comparison not found");
    }
    const existing = await tx.receipt.findUnique({
      where: { comparisonId: comparison.id },
    });
    if (!existing) {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, plan: true },
      });
      await assertWithinPlanLimitForUser(tx, user, "receipts");
    }
    return tx.receipt.upsert({
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
  });
  return toReceipt(row);
}

export async function getReceiptForComparison(
  userId: string,
  comparisonId: string,
): Promise<ReceiptRecord | null> {
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

export async function updateReceiptStatus(
  userId: string,
  args: {
    comparisonId: string;
    status: ReceiptStatus;
    executionResult: string | null;
  },
): Promise<ReceiptRecord> {
  const comparison = await prisma.comparison.findFirst({
    where: { id: args.comparisonId, userId },
    select: { id: true },
  });
  if (!comparison) {
    throw new StoreError("comparison_not_found", "Comparison not found");
  }
  const row = await prisma.receipt.update({
    where: { comparisonId: comparison.id },
    data: { status: args.status, executionResult: args.executionResult },
  });
  return toReceipt(row);
}
