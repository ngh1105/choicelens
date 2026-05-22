import { NextResponse } from "next/server";
import { addWatchlistEntry, StoreError } from "@/lib/store";
import {
  assertWithinPlanLimit,
  getExistingWatchlistEntryForComparison,
  PlanLimitError,
  planLimitPayload,
} from "@/lib/usage";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const existing = await getExistingWatchlistEntryForComparison(id);
    if (!existing) {
      await assertWithinPlanLimit("watchlist");
    }
    const entry = await addWatchlistEntry({ comparisonId: id });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return NextResponse.json(planLimitPayload(err), { status: 402 });
    }
    if (err instanceof StoreError && err.code === "comparison_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error(`POST /api/comparisons/${id}/watchlist failed`, err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
