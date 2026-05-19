import { config } from "dotenv";
import { createReadClient, createServiceWriteClient } from "../src/lib/genlayer/client";
import { buildCreateDecisionReceiptInput } from "../src/lib/genlayer/buildInput";
import type { ComparisonResult } from "../src/lib/comparison";

config({ path: ".env" });

const SYNTHETIC_RESULT: ComparisonResult = {
  topPick: {
    id: "smoke-opt-1",
    name: "Smoke Test Option",
    finalScore: 0.82,
    agentScores: [],
    rank: 1,
  },
  shortlist: [],
  ranked: [],
  signals: { confidence: 0.7, uncertainty: [], whatWouldChange: [] },
  receiptPayloadHash: "0".repeat(64),
};

async function main() {
  if (process.env.GENLAYER_NETWORK !== "studionet") {
    throw new Error("Set GENLAYER_NETWORK=studionet before running.");
  }
  const contractAddress = process.env.GENLAYER_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("GENLAYER_CONTRACT_ADDRESS not set.");
  }

  const id = `smoke_${Date.now()}`;
  const input = buildCreateDecisionReceiptInput({
    id,
    category: "smoke",
    result: SYNTHETIC_RESULT,
  });

  console.log("[smoke] built input:", input);

  const write = createServiceWriteClient();
  const txHash = (await write.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: "create_receipt",
    args: [
      input.receiptId,
      `0x${input.payloadHash}`,
      input.schemaVersion,
      input.category,
      `0x${input.recommendationHash}`,
      input.confidenceBand,
      input.publicSummaryHash ? `0x${input.publicSummaryHash}` : null,
    ],
    value: 0n,
  })) as `0x${string}`;

  console.log("[smoke] tx hash:", txHash);

  const read = createReadClient();
  const receipt = await read.waitForTransactionReceipt({
    hash: txHash,
    // genlayer-js polls until status; no `timeout` arg, only interval/retries.
    status: "FINALIZED" as never,
  });

  const exec =
    (receipt as { consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> } })
      ?.consensus_data?.leader_receipt?.[0]?.execution_result ?? "(none)";
  const status =
    (receipt as { statusName?: string; status?: string })?.statusName ??
    (receipt as { status?: string })?.status ??
    "(unknown)";

  console.log("[smoke] status:", status, "exec:", exec);

  if (exec !== "FINISHED_WITH_RETURN") {
    throw new Error(`Smoke failed: execution_result=${exec}`);
  }
  console.log("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] error:", err);
  process.exit(1);
});
