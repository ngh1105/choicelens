import { NextResponse } from "next/server";
import {
  buildCreateDecisionReceiptInput,
} from "@/lib/genlayer";
import { getComparison, type ComparisonRecord } from "@/lib/store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function deriveCategory(comparison: ComparisonRecord): string {
  return comparison.input.prompt?.split(" ")[0] ?? "general";
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const comparison = await getComparison(id);
    if (!comparison) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const input = buildCreateDecisionReceiptInput({
      id: comparison.id,
      category: deriveCategory(comparison),
      result: comparison.result,
    });
    return NextResponse.json({
      input,
      contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS ?? null,
      network: process.env.GENLAYER_NETWORK ?? "mock",
    });
  } catch (err) {
    console.error(
      `GET /api/comparisons/${id}/receipt/build-input failed`,
      err,
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
