"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { mainnet, sepolia } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

export const isWalletConfigured =
  typeof projectId === "string" && projectId.length > 0;

const genlayerNetwork = process.env.NEXT_PUBLIC_GENLAYER_NETWORK ?? "mock";
const genlayerChainIdEnv = process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID;
const genlayerRpcUrl = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "";
const genlayerContractAddress =
  process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS ?? "";

const parsedChainId = genlayerChainIdEnv
  ? Number.parseInt(genlayerChainIdEnv, 10)
  : Number.NaN;

export const genlayerChainId =
  Number.isFinite(parsedChainId) && parsedChainId > 0
    ? parsedChainId
    : null;

export const isGenLayerWalletPathConfigured =
  genlayerNetwork === "studionet" &&
  genlayerChainId !== null &&
  genlayerRpcUrl.length > 0 &&
  genlayerContractAddress.length > 0;

export const genlayerStudionetChain =
  genlayerChainId !== null && genlayerRpcUrl.length > 0
    ? defineChain({
        id: genlayerChainId,
        name: "GenLayer Studionet",
        nativeCurrency: { name: "Gen", symbol: "GEN", decimals: 18 },
        rpcUrls: { default: { http: [genlayerRpcUrl] } },
      })
    : null;

export const genlayerWalletConfig = {
  network: genlayerNetwork,
  contractAddress: genlayerContractAddress,
  chainId: genlayerChainId,
  rpcUrl: genlayerRpcUrl,
};

const baseChains = [mainnet, sepolia] as const;
const chains = (
  genlayerStudionetChain
    ? [...baseChains, genlayerStudionetChain]
    : baseChains
);

export const wagmiConfig = projectId
  ? getDefaultConfig({
      appName: "ChoiceLens",
      projectId,
      chains: chains as never,
      ssr: true,
    })
  : null;
