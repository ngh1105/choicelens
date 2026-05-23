import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/store";
import {
  getOrCreateVisitorUser,
  visitorJson,
  type VisitorUser,
} from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  let visitor: VisitorUser;
  try {
    visitor = await getOrCreateVisitorUser(request);
  } catch (err) {
    console.error("GET /api/watchlist failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
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
