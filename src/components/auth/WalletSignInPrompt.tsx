"use client";

import { useCallback, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CheckCircle2, ShieldCheck, Wallet } from "lucide-react";
import { SiweMessage } from "siwe";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { isWalletConfigured } from "@/lib/wallet";

type WalletPromptState =
  | "wallet_unavailable"
  | "wallet_disconnected"
  | "wallet_connected_unsigned"
  | "signed_session_ready"
  | "signing_rejected";

interface WalletSignInPromptProps {
  onSessionReady?: () => void;
}

interface NonceResponse {
  nonce: string;
}

function buildClientSiweMessage(args: {
  address: string;
  nonce: string;
  chainId: number;
}): string {
  const origin = window.location.origin;
  return new SiweMessage({
    domain: window.location.host,
    address: args.address,
    statement: "Sign in to ChoiceLens to manage your paid plan.",
    uri: origin,
    version: "1",
    chainId: args.chainId,
    nonce: args.nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();
}

function promptCopy(state: WalletPromptState): string {
  switch (state) {
    case "wallet_unavailable":
      return "Wallet sign-in is not configured in this environment.";
    case "wallet_disconnected":
      return "Connect a wallet before starting Plus checkout.";
    case "signed_session_ready":
      return "Wallet session ready. Checkout can start.";
    case "signing_rejected":
      return "Wallet signature was cancelled. You can try again.";
    case "wallet_connected_unsigned":
    default:
      return "Sign once to link this browser session to your wallet.";
  }
}

export function WalletSignInPrompt({ onSessionReady }: WalletSignInPromptProps) {
  if (!isWalletConfigured) {
    return (
      <div className="wallet-signin">
        <div className="wallet-signin-copy">
          <span className="wallet-signin-icon" aria-hidden="true">
            <ShieldCheck size={16} />
          </span>
          <div>
            <p className="wallet-signin-title">Wallet sign-in</p>
            <p className="wallet-signin-state">
              {promptCopy("wallet_unavailable")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <ConfiguredWalletSignInPrompt onSessionReady={onSessionReady} />;
}

function ConfiguredWalletSignInPrompt({
  onSessionReady,
}: WalletSignInPromptProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<WalletPromptState>("wallet_disconnected");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentState = useMemo<WalletPromptState>(() => {
    if (status === "signed_session_ready" || status === "signing_rejected") {
      return status;
    }
    if (!isConnected || !address) return "wallet_disconnected";
    return "wallet_connected_unsigned";
  }, [address, isConnected, status]);

  const handleSign = useCallback(async () => {
    if (!address || !isConnected) return;
    setBusy(true);
    setError(null);
    try {
      const nonceRes = await fetch("/api/auth/siwe/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!nonceRes.ok) throw new Error("Could not create a wallet challenge.");
      const { nonce } = (await nonceRes.json()) as NonceResponse;
      const message = buildClientSiweMessage({
        address,
        nonce,
        chainId: chainId || 1,
      });
      const signature = await signMessageAsync({ message });
      const verifyRes = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Wallet signature could not be verified.");
      }
      setStatus("signed_session_ready");
      onSessionReady?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const rejected = message.toLowerCase().includes("reject");
      setStatus(rejected ? "signing_rejected" : "wallet_connected_unsigned");
      setError(rejected ? null : message);
    } finally {
      setBusy(false);
    }
  }, [address, chainId, isConnected, onSessionReady, signMessageAsync]);

  return (
    <div className="wallet-signin">
      <div className="wallet-signin-copy">
        <span className="wallet-signin-icon" aria-hidden="true">
          {currentState === "signed_session_ready" ? (
            <CheckCircle2 size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
        </span>
        <div>
          <p className="wallet-signin-title">Wallet sign-in</p>
          <p className="wallet-signin-state">{promptCopy(currentState)}</p>
        </div>
      </div>
      <div className="wallet-signin-actions">
        <ConnectButton />
        {isConnected && currentState !== "signed_session_ready" ? (
          <button
            className="btn"
            type="button"
            onClick={handleSign}
            disabled={busy}
          >
            <Wallet size={14} />
            {busy ? "Signing..." : "Sign session"}
          </button>
        ) : null}
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}
