import { NextResponse } from "next/server";
import { addWatchlistEntry, StoreError } from "@/lib/store";

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
    const entry = await addWatchlistEntry({ comparisonId: id });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
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
