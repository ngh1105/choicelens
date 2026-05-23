import { NextResponse } from "next/server";
import {
  DEFAULT_PRIORITIES,
  runComparison,
  type ComparisonInput,
  type OptionInput,
  type Priority,
  type PriorityWeights,
} from "@/lib/comparison";
import { listComparisons, saveComparison } from "@/lib/store";
import {
  assertWithinPlanLimit,
  PlanLimitError,
  planLimitPayload,
} from "@/lib/usage";
import {
  getOrCreateVisitorUser,
  visitorJson,
  type VisitorUser,
} from "@/lib/visitor";

export const dynamic = "force-dynamic";

const PRIORITY_KEYS: Priority[] = [
  "price",
  "quality",
  "convenience",
  "risk",
  "durability",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

function parseOptions(value: unknown): OptionInput[] | null {
  if (!Array.isArray(value)) return null;
  const out: OptionInput[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const id = typeof raw.id === "string" ? raw.id : null;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!id || name.length === 0) continue;
    const url = typeof raw.url === "string" ? raw.url : undefined;
    const notes = typeof raw.notes === "string" ? raw.notes : undefined;
    out.push({ id, name, url, notes });
  }
  if (out.length < 2) return null;
  return out;
}

function parsePriorities(value: unknown): PriorityWeights {
  if (!isRecord(value)) return { ...DEFAULT_PRIORITIES };
  const result: PriorityWeights = { ...DEFAULT_PRIORITIES };
  for (const key of PRIORITY_KEYS) {
    result[key] = clampNumber(value[key], 0, 100, DEFAULT_PRIORITIES[key]);
  }
  return result;
}

function parseInput(payload: unknown): ComparisonInput | null {
  if (!isRecord(payload)) return null;
  const options = parseOptions(payload.options);
  if (!options) return null;
  return {
    prompt: typeof payload.prompt === "string" ? payload.prompt : "",
    options,
    priorities: parsePriorities(payload.priorities),
    mustHaves: typeof payload.mustHaves === "string" ? payload.mustHaves : "",
    dealBreakers:
      typeof payload.dealBreakers === "string" ? payload.dealBreakers : "",
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  let visitor: VisitorUser;
  try {
    visitor = await getOrCreateVisitorUser(request);
  } catch (err) {
    console.error("GET /api/comparisons failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  try {
    const items = await listComparisons(visitor.id);
    return visitorJson(visitor, { comparisons: items });
  } catch (err) {
    console.error("GET /api/comparisons failed", err);
    return visitorJson(
      visitor,
      { error: "internal_error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let visitor: VisitorUser;
  let payload: unknown;
  try {
    visitor = await getOrCreateVisitorUser(request);
  } catch (err) {
    console.error("POST /api/comparisons failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  try {
    payload = await request.json();
  } catch {
    return visitorJson(
      visitor,
      { error: "invalid_json" },
      { status: 400 },
    );
  }
  const input = parseInput(payload);
  if (!input) {
    return visitorJson(
      visitor,
      { error: "invalid_input", message: "At least 2 named options are required" },
      { status: 400 },
    );
  }
  try {
    await assertWithinPlanLimit(visitor, "comparisons");
    const result = runComparison(input);
    const record = await saveComparison(visitor.id, { input, result });
    return visitorJson(visitor, { comparison: record }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return visitorJson(visitor, planLimitPayload(err), { status: 402 });
    }
    console.error("POST /api/comparisons failed", err);
    return visitorJson(
      visitor,
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
