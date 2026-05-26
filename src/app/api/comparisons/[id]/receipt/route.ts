import { NextResponse } from "next/server";
import {
  buildCreateDecisionReceiptInput,
  getGenLayerService,
  HTTP_STATUS_BY_CODE,
  isGenLayerError,
  type ReceiptStatus,
} from "@/lib/genlayer";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
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
import { visitorJson } from "@/lib/visitor";

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
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  let visitor: RequestUser;
  try {
    visitor = await getRequestUser(request);
  } catch (err) {
    console.error(`GET /api/comparisons/${id}/receipt failed`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  try {
    const row = await getReceiptForComparison(visitor.id, id);
    if (!row) {
      return visitorJson(visitor, { error: "not_found" }, { status: 404 });
    }
    if (TERMINAL_STATUSES.has(row.status) || !row.transactionHash) {
      return visitorJson(visitor, { receipt: row });
    }
    const svc = getGenLayerService();
    if (!svc.refreshReceiptStatus) {
      return visitorJson(visitor, { receipt: row });
    }
    try {
      const update = await svc.refreshReceiptStatus(row.transactionHash);
      if (update.status === row.status) {
        return visitorJson(visitor, { receipt: row });
      }
      const next = await updateReceiptStatus(visitor.id, {
        comparisonId: id,
        status: update.status as ReceiptStatus,
        executionResult: update.executionResult,
      });
      return visitorJson(visitor, { receipt: next });
    } catch (err) {
      if (isGenLayerError(err) && err.code === "transaction_timeout") {
        return visitorJson(visitor, { receipt: row });
      }
      if (isGenLayerError(err)) {
        return visitorJson(
          visitor,
          { error: err.code },
          { status: HTTP_STATUS_BY_CODE[err.code] },
        );
      }
      throw err;
    }
  } catch (err) {
    console.error(`GET /api/comparisons/${id}/receipt failed`, err);
    return visitorJson(visitor, { error: "internal_error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  let visitor: RequestUser;
  try {
    visitor = await getRequestUser(request);
  } catch (err) {
    console.error(`POST /api/comparisons/${id}/receipt failed`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  try {
    const comparison = await getComparison(visitor.id, id);
    if (!comparison) {
      return visitorJson(visitor, { error: "not_found" }, { status: 404 });
    }
    const existing = await getReceiptForComparison(visitor.id, id);
    if (existing) {
      return visitorJson(visitor, { receipt: existing });
    }
    await assertWithinPlanLimit(visitor, "receipts");
    const svc = getGenLayerService();
    const isMock = (process.env.GENLAYER_NETWORK ?? "mock") === "mock";
    if (isMock || !svc.createDecisionReceipt) {
      const built = svc.buildReceipt(comparison.result);
      const record = await saveReceipt(visitor.id, {
        comparisonId: id,
        receipt: built,
        submitterKind: "mock",
      });
      return visitorJson(visitor, { receipt: record }, { status: 201 });
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
      const record = await saveReceipt(visitor.id, {
        comparisonId: id,
        receipt: { ...built, transactionHash, status: "pending" },
        submitterKind: "service",
        creatorAddress,
      });
      return visitorJson(visitor, { receipt: record }, { status: 201 });
    } catch (err) {
      if (isGenLayerError(err)) {
        return visitorJson(
          visitor,
          { error: err.code },
          { status: HTTP_STATUS_BY_CODE[err.code] },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return visitorJson(visitor, planLimitPayload(err), { status: 402 });
    }
    if (err instanceof StoreError && err.code === "comparison_not_found") {
      return visitorJson(visitor, { error: "not_found" }, { status: 404 });
    }
    console.error(`POST /api/comparisons/${id}/receipt failed`, err);
    return visitorJson(visitor, { error: "internal_error" }, { status: 500 });
  }
}
