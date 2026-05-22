import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/store";
import { getOrCreateVisitorUser, visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const visitor = await getOrCreateVisitorUser(request);
  try {
    const items = await listWatchlist(visitor.id);
    return visitorJson(visitor, { watchlist: items });
  } catch (err) {
    console.error("GET /api/watchlist failed", err);
    return visitorJson(
      visitor,
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
