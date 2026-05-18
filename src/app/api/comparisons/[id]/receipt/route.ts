import { NextResponse } from "next/server";
import { getGenLayerService } from "@/lib/genlayer";
import {
  getComparison,
  getReceiptForComparison,
  saveReceipt,
  StoreError,
} from "@/lib/store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const receipt = await getReceiptForComparison(id);
    if (!receipt) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ receipt });
  } catch (err) {
    console.error(`GET /api/comparisons/${id}/receipt failed`, err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
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
    const built = getGenLayerService().buildReceipt(comparison.result);
    const record = await saveReceipt({ comparisonId: id, receipt: built });
    return NextResponse.json({ receipt: record }, { status: 201 });
  } catch (err) {
    if (err instanceof StoreError && err.code === "comparison_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error(`POST /api/comparisons/${id}/receipt failed`, err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
