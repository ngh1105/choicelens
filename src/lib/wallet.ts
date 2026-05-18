"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";

const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "choicelens-dev-placeholder";

export const wagmiConfig = getDefaultConfig({
  appName: "ChoiceLens",
  projectId,
  chains: [mainnet, sepolia],
  ssr: true,
});

export const isWalletConfigured =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID !== undefined &&
  process.env.NEXT_PUBLIC_WC_PROJECT_ID.length > 0;
