import { NextResponse } from "next/server";
import { getComparison } from "@/lib/store";
import { getOrCreateVisitorUser, visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const visitor = await getOrCreateVisitorUser(request);
  try {
    const record = await getComparison(visitor.id, id);
    if (!record) {
      return visitorJson(
        visitor,
        { error: "not_found" },
        { status: 404 },
      );
    }
    return visitorJson(visitor, { comparison: record });
  } catch (err) {
    console.error(`GET /api/comparisons/${id} failed`, err);
    return visitorJson(
      visitor,
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
