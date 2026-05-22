import { NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const summary = await getUsageSummary();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("GET /api/usage failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
