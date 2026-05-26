import { NextResponse } from "next/server";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { removeWatchlistEntry } from "@/lib/store";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  let visitor: RequestUser;
  try {
    visitor = await getRequestUser(request);
  } catch (err) {
    console.error(`DELETE /api/watchlist/${id} failed`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
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
