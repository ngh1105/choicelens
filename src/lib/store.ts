import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ComparisonInput, ComparisonResult } from "./comparison";
import type { DecisionReceipt } from "./genlayer";

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
}

interface StoreShape {
  comparisons: ComparisonRecord[];
  watchlist: WatchlistRecord[];
  receipts: ReceiptRecord[];
}

const EMPTY: StoreShape = {
  comparisons: [],
  watchlist: [],
  receipts: [],
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "choicelens.json");

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function isStoreShape(value: unknown): value is StoreShape {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.comparisons) &&
    Array.isArray(v.watchlist) &&
    Array.isArray(v.receipts)
  );
}

async function readRaw(): Promise<StoreShape> {
  try {
    const buf = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(buf) as unknown;
    if (isStoreShape(parsed)) {
      return parsed;
    }
    return { ...EMPTY };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ...EMPTY };
    }
    if (err instanceof SyntaxError) {
      return { ...EMPTY };
    }
    throw err;
  }
}

async function writeRaw(state: StoreShape): Promise<void> {
  await ensureDir();
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}

async function withState<T>(
  fn: (state: StoreShape) => Promise<{ state: StoreShape; value: T }> | { state: StoreShape; value: T },
): Promise<T> {
  return serialize(async () => {
    const state = await readRaw();
    const next = await fn(state);
    await writeRaw(next.state);
    return next.value;
  });
}

async function readState(): Promise<StoreShape> {
  return serialize(() => readRaw());
}

export async function listComparisons(): Promise<ComparisonRecord[]> {
  const state = await readState();
  return [...state.comparisons].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

export async function getComparison(
  id: string,
): Promise<ComparisonRecord | null> {
  const state = await readState();
  return state.comparisons.find((c) => c.id === id) ?? null;
}

export async function saveComparison(args: {
  input: ComparisonInput;
  result: ComparisonResult;
}): Promise<ComparisonRecord> {
  const record: ComparisonRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    input: args.input,
    result: args.result,
  };
  return withState((state) => ({
    state: { ...state, comparisons: [record, ...state.comparisons] },
    value: record,
  }));
}

export async function listWatchlist(): Promise<WatchlistRecord[]> {
  const state = await readState();
  return [...state.watchlist].sort((a, b) =>
    a.addedAt < b.addedAt ? 1 : -1,
  );
}

export async function addWatchlistEntry(args: {
  comparisonId: string;
}): Promise<WatchlistRecord> {
  return withState((state) => {
    const comparison = state.comparisons.find(
      (c) => c.id === args.comparisonId,
    );
    if (!comparison) {
      throw new StoreError("comparison_not_found", "Comparison not found");
    }
    const top = comparison.result.topPick;
    const existing = state.watchlist.find(
      (w) =>
        w.comparisonId === comparison.id &&
        w.payloadHash === comparison.result.receiptPayloadHash,
    );
    if (existing) {
      return { state, value: existing };
    }
    const entry: WatchlistRecord = {
      id: randomUUID(),
      comparisonId: comparison.id,
      optionId: top.id,
      name: top.name,
      score: top.finalScore,
      payloadHash: comparison.result.receiptPayloadHash,
      addedAt: new Date().toISOString(),
    };
    return {
      state: { ...state, watchlist: [entry, ...state.watchlist] },
      value: entry,
    };
  });
}

export async function removeWatchlistEntry(id: string): Promise<boolean> {
  return withState((state) => {
    const next = state.watchlist.filter((w) => w.id !== id);
    const removed = next.length !== state.watchlist.length;
    return {
      state: { ...state, watchlist: next },
      value: removed,
    };
  });
}

export async function saveReceipt(args: {
  comparisonId: string;
  receipt: DecisionReceipt;
}): Promise<ReceiptRecord> {
  return withState((state) => {
    const comparison = state.comparisons.find(
      (c) => c.id === args.comparisonId,
    );
    if (!comparison) {
      throw new StoreError("comparison_not_found", "Comparison not found");
    }
    const record: ReceiptRecord = {
      ...args.receipt,
      comparisonId: comparison.id,
    };
    const filtered = state.receipts.filter(
      (r) => r.comparisonId !== comparison.id,
    );
    return {
      state: { ...state, receipts: [record, ...filtered] },
      value: record,
    };
  });
}

export async function getReceiptForComparison(
  comparisonId: string,
): Promise<ReceiptRecord | null> {
  const state = await readState();
  return state.receipts.find((r) => r.comparisonId === comparisonId) ?? null;
}

export class StoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "StoreError";
  }
}
