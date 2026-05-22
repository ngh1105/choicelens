import { NextResponse } from "next/server";
import {
  buildCreateDecisionReceiptInput,
  getGenLayerService,
  HTTP_STATUS_BY_CODE,
  isGenLayerError,
  type ReceiptStatus,
} from "@/lib/genlayer";
import {
  getComparison,
  getReceiptForComparison,
  saveReceipt,
  StoreError,
  updateReceiptStatus,
  type ComparisonRecord,
} from "@/lib/store";
import {
  assertWithinPlanLimit,
  PlanLimitError,
  planLimitPayload,
} from "@/lib/usage";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const TERMINAL_STATUSES = new Set<ReceiptStatus>([
  "finalized",
  "finalized_with_error",
  "failed",
  "off_chain_only",
]);

function deriveCategory(comparison: ComparisonRecord): string {
  return comparison.input.prompt?.split(" ")[0] ?? "general";
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const row = await getReceiptForComparison(id);
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (TERMINAL_STATUSES.has(row.status) || !row.transactionHash) {
      return NextResponse.json({ receipt: row });
    }
    const svc = getGenLayerService();
    if (!svc.refreshReceiptStatus) {
      return NextResponse.json({ receipt: row });
    }
    try {
      const update = await svc.refreshReceiptStatus(row.transactionHash);
      if (update.status === row.status) {
        return NextResponse.json({ receipt: row });
      }
      const next = await updateReceiptStatus({
        comparisonId: id,
        status: update.status as ReceiptStatus,
        executionResult: update.executionResult,
      });
      return NextResponse.json({ receipt: next });
    } catch (err) {
      if (isGenLayerError(err) && err.code === "transaction_timeout") {
        return NextResponse.json({ receipt: row });
      }
      if (isGenLayerError(err)) {
        return NextResponse.json(
          { error: err.code },
          { status: HTTP_STATUS_BY_CODE[err.code] },
        );
      }
      throw err;
    }
  } catch (err) {
    console.error(`GET /api/comparisons/${id}/receipt failed`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const comparison = await getComparison(id);
    if (!comparison) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const existing = await getReceiptForComparison(id);
    if (existing) {
      return NextResponse.json({ receipt: existing });
    }
    await assertWithinPlanLimit("receipts");
    const svc = getGenLayerService();
    const isMock = (process.env.GENLAYER_NETWORK ?? "mock") === "mock";
    if (isMock || !svc.createDecisionReceipt) {
      const built = svc.buildReceipt(comparison.result);
      const record = await saveReceipt({
        comparisonId: id,
        receipt: built,
        submitterKind: "mock",
      });
      return NextResponse.json({ receipt: record }, { status: 201 });
    }
    const input = buildCreateDecisionReceiptInput({
      id: comparison.id,
      category: deriveCategory(comparison),
      result: comparison.result,
    });
    try {
      const { transactionHash, creatorAddress } =
        await svc.createDecisionReceipt(input);
      const built = svc.buildReceipt(comparison.result);
      const record = await saveReceipt({
        comparisonId: id,
        receipt: { ...built, transactionHash, status: "pending" },
        submitterKind: "service",
        creatorAddress,
      });
      return NextResponse.json({ receipt: record }, { status: 201 });
    } catch (err) {
      if (isGenLayerError(err)) {
        return NextResponse.json(
          { error: err.code },
          { status: HTTP_STATUS_BY_CODE[err.code] },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return NextResponse.json(planLimitPayload(err), { status: 402 });
    }
    if (err instanceof StoreError && err.code === "comparison_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error(`POST /api/comparisons/${id}/receipt failed`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
