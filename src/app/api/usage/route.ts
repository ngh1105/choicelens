import { NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/usage";
import { getOrCreateVisitorUser, visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const visitor = await getOrCreateVisitorUser(request);
  try {
    const summary = await getUsageSummary(visitor);
    return visitorJson(visitor, summary);
  } catch (err) {
    console.error("GET /api/usage failed", err);
    return visitorJson(visitor, { error: "internal_error" }, { status: 500 });
  }
}
