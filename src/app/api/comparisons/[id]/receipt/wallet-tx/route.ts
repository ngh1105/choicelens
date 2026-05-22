import { NextResponse } from "next/server";
import { getGenLayerService } from "@/lib/genlayer";
import {
  getComparison,
  getReceiptForComparison,
  saveReceipt,
  StoreError,
} from "@/lib/store";
import {
  assertWithinPlanLimit,
  PlanLimitError,
  planLimitPayload,
} from "@/lib/usage";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const HEX_RX = /^0x[0-9a-fA-F]+$/;

function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX_RX.test(value);
}

function isAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(value)
  );
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null) {
    return NextResponse.json({ error: "wallet_not_connected" }, { status: 400 });
  }
  const body = payload as { transactionHash?: unknown; creatorAddress?: unknown };

  if (body.transactionHash === undefined || body.creatorAddress === undefined) {
    return NextResponse.json({ error: "wallet_not_connected" }, { status: 400 });
  }
  if (!isHex(body.transactionHash) || !isAddress(body.creatorAddress)) {
    return NextResponse.json({ error: "wallet_rejected" }, { status: 400 });
  }

  const transactionHash = body.transactionHash;
  const creatorAddress = body.creatorAddress;

  try {
    const comparison = await getComparison(id);
    if (!comparison) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const existing = await getReceiptForComparison(id);
    if (existing) {
      return NextResponse.json({ receipt: existing });
    }
    await assertWithinPlanLimit("receipts");

    // Server derives the receipt shell. The client only contributes tx proof.
    const built = getGenLayerService().buildReceipt(comparison.result);
    const record = await saveReceipt({
      comparisonId: id,
      receipt: { ...built, transactionHash, status: "pending" },
      submitterKind: "user",
      creatorAddress,
    });
    return NextResponse.json({ receipt: record }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return NextResponse.json(planLimitPayload(err), { status: 402 });
    }
    if (err instanceof StoreError && err.code === "comparison_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error(
      `POST /api/comparisons/${id}/receipt/wallet-tx failed`,
      err,
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
