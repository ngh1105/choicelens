import { NextResponse } from "next/server";
import { removeWatchlistEntry } from "@/lib/store";
import { getOrCreateVisitorUser, visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const visitor = await getOrCreateVisitorUser(request);
  try {
    const removed = await removeWatchlistEntry(visitor.id, id);
    if (!removed) {
      return visitorJson(visitor, { error: "not_found" }, { status: 404 });
    }
    return visitorJson(visitor, { removed: true });
  } catch (err) {
    console.error(`DELETE /api/watchlist/${id} failed`, err);
    return visitorJson(
      visitor,
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
