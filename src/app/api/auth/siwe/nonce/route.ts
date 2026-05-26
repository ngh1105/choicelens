import { NextResponse } from "next/server";
import { createSiweNonce } from "@/lib/auth/siwe";
import { getOrCreateVisitorUser, visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const visitor = await getOrCreateVisitorUser(request);
    const nonce = await createSiweNonce(visitor.id);
    return visitorJson(visitor, { nonce });
  } catch (err) {
    console.error("POST /api/auth/siwe/nonce failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
