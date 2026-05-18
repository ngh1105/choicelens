import { NextResponse } from "next/server";
import { getComparison } from "@/lib/store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const record = await getComparison(id);
    if (!record) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ comparison: record });
  } catch (err) {
    console.error(`GET /api/comparisons/${id} failed`, err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
