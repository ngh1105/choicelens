/**
 * One-shot Studionet deploy + smoke using an in-process ephemeral key.
 * The private key is generated, used, and discarded — never logged, never written.
 *
 * Usage (PowerShell / bash):
 *   GENLAYER_NETWORK=studionet \
 *   GENLAYER_RPC_URL=https://studio.genlayer.com/api \
 *   npx tsx scripts/deploy-and-smoke-ephemeral.ts
 */
import { readFileSync } from "fs";
import path from "path";
import crypto from "crypto";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

function generateEphemeralKey(): `0x${string}` {
  return ("0x" + crypto.randomBytes(32).toString("hex")) as `0x${string}`;
}

function pickContractAddress(receipt: unknown): string | null {
  const r = receipt as Record<string, unknown> | null;
  if (!r) return null;
  const direct = (r as { contract_address?: string }).contract_address;
  if (typeof direct === "string") return direct;
  const data = (r as { data?: { contract_address?: string } }).data;
  if (data && typeof data.contract_address === "string") return data.contract_address;
  const consensus = (r as { consensus_data?: { leader_receipt?: Array<{ contract_address?: string }> } })
    .consensus_data;
  const lr = consensus?.leader_receipt?.[0];
  if (lr && typeof lr.contract_address === "string") return lr.contract_address;
  return null;
}

function summarize(receipt: unknown) {
  const r = (receipt ?? {}) as Record<string, unknown>;
  const statusName =
    (r as { statusName?: string }).statusName ??
    (r as { status?: string }).status ??
    "(unknown)";
  const consensus = (r as { consensus_data?: Record<string, unknown> }).consensus_data ?? {};
  const lr = (consensus as { leader_receipt?: Array<Record<string, unknown>> }).leader_receipt?.[0] ?? {};
  return {
    statusName,
    result_name: (r as { result_name?: string }).result_name ?? null,
    execution_result: (lr as { execution_result?: string }).execution_result ?? null,
    leader_status: (lr as { result?: { status?: string } }).result?.status ?? null,
    last_leader: (consensus as { last_leader?: string }).last_leader ?? null,
  };
}

async function main() {
  if (process.env.GENLAYER_NETWORK !== "studionet") {
    throw new Error("Set GENLAYER_NETWORK=studionet");
  }
  if (!process.env.GENLAYER_RPC_URL) {
    throw new Error("Set GENLAYER_RPC_URL=https://studio.genlayer.com/api");
  }

  const pk = generateEphemeralKey();
  const account = createAccount(pk);
  const client = createClient({
    chain: studionet,
    account,
    endpoint: process.env.GENLAYER_RPC_URL,
  });

  const source = readFileSync(
    path.resolve("contracts/ChoiceLensDecisionRegistry.py"),
    "utf8",
  );

  console.log("[deploy] sending...");
  const deployTx = (await client.deployContract({
    code: source,
    args: [],
    leaderOnly: false,
  })) as `0x${string}`;
  console.log("[deploy] tx:", deployTx);

  const deployReceipt = await client.waitForTransactionReceipt({
    hash: deployTx,
    status: "FINALIZED" as never,
  });
  const dSum = summarize(deployReceipt);
  console.log("[deploy] summary:", dSum);

  const contractAddress = pickContractAddress(deployReceipt);
  if (!contractAddress) {
    console.error("[deploy] FAILED: no contract address in receipt.");
    console.error("[deploy] receipt:", JSON.stringify(deployReceipt, null, 2));
    process.exit(2);
  }
  if (
    dSum.execution_result &&
    dSum.execution_result !== "SUCCESS" &&
    dSum.execution_result !== "FINISHED_WITH_RETURN"
  ) {
    console.error("[deploy] FAILED: execution_result=", dSum.execution_result);
    console.error("[deploy] receipt:", JSON.stringify(deployReceipt, null, 2));
    process.exit(3);
  }
  console.log("[deploy] contract_address:", contractAddress);

  // Smoke create_receipt against the new contract using the same ephemeral key.
  const receiptId = `smoke_${Date.now()}`;
  const payloadHash = `0x${"a".repeat(64)}` as `0x${string}`;
  const recommendationHash = `0x${"b".repeat(64)}` as `0x${string}`;
  const publicSummaryHash = `0x${"c".repeat(64)}` as `0x${string}`;

  console.log("[smoke] sending create_receipt...");
  const smokeTx = (await client.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: "create_receipt",
    args: [
      receiptId,
      payloadHash,
      "v1",
      "smoke",
      recommendationHash,
      "high",
      publicSummaryHash,
    ],
    value: 0n,
  })) as `0x${string}`;
  console.log("[smoke] tx:", smokeTx);

  const smokeReceipt = await client.waitForTransactionReceipt({
    hash: smokeTx,
    status: "FINALIZED" as never,
  });
  const sSum = summarize(smokeReceipt);
  console.log("[smoke] summary:", sSum);

  if (sSum.execution_result !== "SUCCESS" && sSum.execution_result !== "FINISHED_WITH_RETURN") {
    console.error("[smoke] FAILED: execution_result=", sSum.execution_result);
    console.error("[smoke] receipt:", JSON.stringify(smokeReceipt, null, 2));
    process.exit(4);
  }
  console.log("[smoke] OK");
  console.log(JSON.stringify({
    deployTx,
    contractAddress,
    smokeTx,
    deploy: dSum,
    smoke: sSum,
  }, null, 2));
}

main().catch((err) => {
  console.error("[fatal]", err instanceof Error ? err.message : err);
  process.exit(1);
});
