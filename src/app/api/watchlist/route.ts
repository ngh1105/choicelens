import { NextResponse } from "next/server";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { listWatchlist } from "@/lib/store";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  let visitor: RequestUser;
  try {
    visitor = await getRequestUser(request);
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
