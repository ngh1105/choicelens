import { NextResponse } from "next/server";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { getUsageSummary } from "@/lib/usage";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  let visitor: RequestUser;
  try {
    visitor = await getRequestUser(request);
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
