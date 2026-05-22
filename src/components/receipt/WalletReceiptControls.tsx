"use client";

import { useCallback, useState } from "react";
import { Wallet, ArrowRightLeft } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useConnectorClient } from "wagmi";
import {
  genlayerWalletConfig,
  isGenLayerWalletPathConfigured,
} from "@/lib/wallet";
import {
  WalletPathToggle,
  useWalletPathPreference,
} from "@/components/receipt/WalletPathToggle";
import { submitReceiptWithWallet } from "@/lib/genlayer/walletClient";

interface WalletReceiptControlsProps {
  comparisonId: string | null;
  disabled: boolean;
  onSubmitting: (busy: boolean) => void;
  onSubmitted: (receipt: unknown) => void;
  onError: (message: string) => void;
}

interface BuildInputResponse {
  input: {
    receiptId: string;
    payloadHash: string;
    schemaVersion: string;
    category: string;
    recommendationHash: string;
    confidenceBand: "low" | "medium" | "high";
    publicSummaryHash: string | null;
  };
  contractAddress: string | null;
  network: string;
}

const FATAL_TO_MESSAGE: Record<string, string> = {
  wallet_not_connected: "Connect a wallet first.",
  wrong_network: "Switch to the GenLayer network to sign.",
  contract_not_configured: "Server did not provide a contract address.",
  insufficient_funds: "Wallet balance is too low to cover gas.",
  user_rejected: "Wallet signature was cancelled.",
};

function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("rejected") || lower.includes("denied") || lower.includes("user denied")) {
    return "user_rejected";
  }
  if (lower.includes("insufficient")) return "insufficient_funds";
  if (lower.includes("contract_not_configured")) return "contract_not_configured";
  return "unknown_genlayer_error";
}

export function WalletReceiptControls({
  comparisonId,
  disabled,
  onSubmitting,
  onSubmitted,
  onError,
}: WalletReceiptControlsProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { data: connectorClient } = useConnectorClient();
  const walletPathOn = useWalletPathPreference();
  const [submitting, setSubmitting] = useState<boolean>(false);

  const targetChainId = genlayerWalletConfig.chainId;
  const onCorrectNetwork =
    targetChainId !== null && chainId === targetChainId;

  const handleSwitch = useCallback(() => {
    if (targetChainId === null) return;
    switchChain({ chainId: targetChainId });
  }, [switchChain, targetChainId]);

  const handleSubmit = useCallback(async () => {
    if (!comparisonId) return;
    if (!isConnected || !address) {
      onError(FATAL_TO_MESSAGE.wallet_not_connected);
      return;
    }
    if (!onCorrectNetwork) {
      onError(FATAL_TO_MESSAGE.wrong_network);
      return;
    }
    if (!connectorClient) {
      onError(FATAL_TO_MESSAGE.wallet_not_connected);
      return;
    }
    setSubmitting(true);
    onSubmitting(true);
    try {
      const buildRes = await fetch(
        `/api/comparisons/${comparisonId}/receipt/build-input`,
      );
      if (!buildRes.ok) throw new Error(`build_input_${buildRes.status}`);
      const buildJson = (await buildRes.json()) as BuildInputResponse;
      if (!buildJson.contractAddress) {
        throw new Error("contract_not_configured");
      }

      const txHash = await submitReceiptWithWallet(buildJson, {
        account: address,
        provider: connectorClient.transport,
        chainId: targetChainId as number,
        rpcUrl: genlayerWalletConfig.rpcUrl,
      });

      const persistRes = await fetch(
        `/api/comparisons/${comparisonId}/receipt/wallet-tx`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionHash: txHash,
            creatorAddress: address,
          }),
        },
      );
      if (!persistRes.ok) throw new Error(`wallet_tx_${persistRes.status}`);
      const json = (await persistRes.json()) as { receipt: unknown };
      onSubmitted(json.receipt);
    } catch (err) {
      const code = classifyError(err);
      onError(FATAL_TO_MESSAGE[code] ?? "Could not submit receipt with wallet.");
    } finally {
      setSubmitting(false);
      onSubmitting(false);
    }
  }, [
    comparisonId,
    isConnected,
    address,
    onCorrectNetwork,
    connectorClient,
    targetChainId,
    onSubmitted,
    onSubmitting,
    onError,
  ]);

  if (!isGenLayerWalletPathConfigured) {
    return null;
  }

  return (
    <div className="wallet-path-row">
      <WalletPathToggle disabled={disabled || submitting} />
      {walletPathOn ? (
        !isConnected ? (
          <span className="wallet-path-hint">Connect a wallet to sign.</span>
        ) : !onCorrectNetwork ? (
          <button
            type="button"
            className="btn"
            onClick={handleSwitch}
            disabled={disabled || isSwitching}
          >
            <ArrowRightLeft size={14} />
            {isSwitching ? "Switching..." : "Switch network"}
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={handleSubmit}
            disabled={disabled || submitting || !comparisonId}
          >
            <Wallet size={14} />
            {submitting ? "Signing..." : "Sign with wallet"}
          </button>
        )
      ) : null}
    </div>
  );
}
