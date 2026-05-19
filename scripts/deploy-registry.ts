import { config } from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

config({ path: ".env" });

async function main() {
  const pk = process.env.GENLAYER_SERVICE_PRIVATE_KEY;
  if (!pk) throw new Error("GENLAYER_SERVICE_PRIVATE_KEY missing");
  const account = createAccount(pk as `0x${string}`);
  const client = createClient({
    chain: studionet,
    account,
    endpoint: process.env.GENLAYER_RPC_URL,
  });
  const source = readFileSync(
    path.resolve("contracts/ChoiceLensDecisionRegistry.py"),
    "utf8",
  );
  const txHash = await client.deployContract({
    code: source,
    args: [],
    leaderOnly: false,
  });
  console.log("deploy tx:", txHash);
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: "FINALIZED",
  });
  // Receipt shape varies across genlayer-js versions; operator copies the
  // contract address by hand into .env / runbook (see PR #7).
  console.log("receipt:", JSON.stringify(receipt, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
