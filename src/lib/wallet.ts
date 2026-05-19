"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

export const isWalletConfigured =
  typeof projectId === "string" && projectId.length > 0;

export const wagmiConfig = projectId
  ? getDefaultConfig({
      appName: "ChoiceLens",
      projectId,
      chains: [mainnet, sepolia],
      ssr: true,
    })
  : null;
