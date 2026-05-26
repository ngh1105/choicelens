import { NextResponse } from "next/server";
import {
  buildCreateDecisionReceiptInput,
} from "@/lib/genlayer";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { getComparison, type ComparisonRecord } from "@/lib/store";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

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
    console.error(
      `GET /api/comparisons/${id}/receipt/build-input failed`,
      err,
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  try {
    const comparison = await getComparison(visitor.id, id);
    if (!comparison) {
      return visitorJson(visitor, { error: "not_found" }, { status: 404 });
    }
    const input = buildCreateDecisionReceiptInput({
      id: comparison.id,
      category: deriveCategory(comparison),
      result: comparison.result,
    });
    return visitorJson(visitor, {
      input,
      contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS ?? null,
      network: process.env.GENLAYER_NETWORK ?? "mock",
    });
  } catch (err) {
    console.error(
      `GET /api/comparisons/${id}/receipt/build-input failed`,
      err,
    );
    return visitorJson(visitor, { error: "internal_error" }, { status: 500 });
  }
}
