import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { GenLayerError } from "./errors";

// Import the client type from genlayer-js. If the named type isn't directly exported,
// derive it via ReturnType<typeof createClient> instead.
type GenLayerWriteClient = ReturnType<typeof createClient>;

export function createReadClient(): GenLayerWriteClient {
  return createClient({
    chain: studionet,
    endpoint: process.env.GENLAYER_RPC_URL,
  });
}

export function createServiceWriteClient(): GenLayerWriteClient {
  const pk = process.env.GENLAYER_SERVICE_PRIVATE_KEY;
  if (!pk) throw new GenLayerError("service_account_unavailable", "service key missing");
  const account = createAccount(pk as `0x${string}`);
  return createClient({
    chain: studionet,
    account,
    endpoint: process.env.GENLAYER_RPC_URL,
  });
}
