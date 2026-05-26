import { NextResponse } from "next/server";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { addWatchlistEntry, StoreError } from "@/lib/store";
import {
  assertWithinPlanLimit,
  getExistingWatchlistEntryForComparison,
  PlanLimitError,
  planLimitPayload,
} from "@/lib/usage";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
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
    console.error(`POST /api/comparisons/${id}/watchlist failed`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  try {
    const existing = await getExistingWatchlistEntryForComparison(visitor.id, id);
    if (!existing) {
      await assertWithinPlanLimit(visitor, "watchlist");
    }
    const entry = await addWatchlistEntry(visitor.id, { comparisonId: id });
    return visitorJson(visitor, { entry }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return visitorJson(visitor, planLimitPayload(err), { status: 402 });
    }
    if (err instanceof StoreError && err.code === "comparison_not_found") {
      return visitorJson(visitor, { error: "not_found" }, { status: 404 });
    }
    console.error(`POST /api/comparisons/${id}/watchlist failed`, err);
    return visitorJson(
      visitor,
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
