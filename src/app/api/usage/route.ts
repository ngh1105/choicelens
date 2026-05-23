import { NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/usage";
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
    console.error("GET /api/usage failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  try {
    const summary = await getUsageSummary(visitor);
    return visitorJson(visitor, summary);
  } catch (err) {
    console.error("GET /api/usage failed", err);
    return visitorJson(visitor, { error: "internal_error" }, { status: 500 });
  }
}
