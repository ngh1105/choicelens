import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const items = await listWatchlist();
    return NextResponse.json({ watchlist: items });
  } catch (err) {
    console.error("GET /api/watchlist failed", err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
