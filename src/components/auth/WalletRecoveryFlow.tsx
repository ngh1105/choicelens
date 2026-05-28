"use client";

import { useCallback, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Mail, ShieldCheck, Wallet } from "lucide-react";
import { SiweMessage } from "siwe";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { isWalletConfigured } from "@/lib/wallet";

type Stage = "email" | "otp" | "wallet" | "done";

interface RequestResponse {
  error?: string;
}
interface VerifyResponse {
  recoveryToken?: string;
  expiresAt?: string;
  error?: string;
}
interface ChallengeResponse {
  nonce?: string;
  expiresAt?: string;
  error?: string;
}
interface ConfirmResponse {
  walletAddress?: string;
  recoveryLockedUntil?: string;
  error?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_json: "Invalid request. Refresh and try again.",
  otp_invalid_or_expired: "That code is incorrect or expired. Request a new code.",
  otp_rate_limited: "Too many codes requested. Try again later.",
  otp_locked: "Too many incorrect attempts. Request a new code.",
  recovery_email_invalid: "Enter a valid recovery email address.",
  recovery_token_invalid: "Recovery session expired. Request a new code.",
  recovery_locked: "Recovery is temporarily locked for this account.",
  recovery_challenge_rate_limited:
    "Too many signing attempts. Request a new recovery code.",
  wallet_same_as_current:
    "Connect a different wallet from the current primary wallet.",
  wallet_already_linked: "That wallet is already linked to another account.",
  wallet_invalid: "The connected wallet could not be verified.",
  internal_error: "Something went wrong. Try again later.",
};

function errorMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}

function buildRecoverySiweMessage(args: {
  address: string;
  nonce: string;
  chainId: number;
}): string {
  const origin = window.location.origin;
  return new SiweMessage({
    domain: window.location.host,
    address: args.address,
    statement:
      "Recover ChoiceLens account access by binding this wallet as the new primary.",
    uri: origin,
    version: "1",
    chainId: args.chainId,
    nonce: args.nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();
}

export function WalletRecoveryFlow() {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [recoveredAddress, setRecoveredAddress] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  const requestOtp = useCallback(async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch("/api/auth/recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!response.ok && response.status !== 204) {
        const body = (await response
          .json()
          .catch(() => ({}))) as RequestResponse;
        throw new Error(errorMessage(body.error, "Recovery request failed."));
      }
      setInfo(
        "If this email is on file, a 6-digit code is on its way. It expires in 10 minutes.",
      );
      setStage("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [email]);

  const verifyOtp = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/recovery/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp.trim() }),
      });
      const body = (await response
        .json()
        .catch(() => ({}))) as VerifyResponse;
      if (!response.ok || !body.recoveryToken) {
        throw new Error(
          errorMessage(body.error, "We could not verify that code. Try again."),
        );
      }
      setRecoveryToken(body.recoveryToken);
      setInfo(
        "Code accepted. Connect the wallet you want to make your new primary, then sign once.",
      );
      setStage("wallet");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [email, otp]);

  return (
    <div className="account-layout">
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Recover wallet access</span>
          <span className="panel-subtitle">
            {stage === "email"
              ? "Step 1 of 3"
              : stage === "otp"
              ? "Step 2 of 3"
              : stage === "wallet"
              ? "Step 3 of 3"
              : "Done"}
          </span>
        </div>
        <div className="panel-body">
          <p className="section-helper">
            Use the email you previously verified for recovery. We send a
            one-time code, then a fresh signature from your new wallet binds it
            as your primary. The old wallet stops being able to sign in.
          </p>

          {stage === "email" ? (
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy) requestOtp();
              }}
            >
              <label className="field">
                <span className="field-label">Recovery email</span>
                <span className="account-input-row">
                  <Mail size={14} />
                  <input
                    className="text-input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    placeholder="name@example.com"
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                  />
                </span>
              </label>
              <button className="btn" type="submit" disabled={busy || !email.trim()}>
                {busy ? "Sending..." : "Send recovery code"}
              </button>
            </form>
          ) : null}

          {stage === "otp" ? (
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy) verifyOtp();
              }}
            >
              <label className="field">
                <span className="field-label">6-digit code</span>
                <input
                  className="text-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={otp}
                  placeholder="123456"
                  onChange={(event) =>
                    setOtp(event.currentTarget.value.replace(/\D/g, ""))
                  }
                  required
                />
              </label>
              <button
                className="btn"
                type="submit"
                disabled={busy || otp.length !== 6}
              >
                {busy ? "Verifying..." : "Verify code"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setOtp("");
                  setStage("email");
                  setInfo(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Change email
              </button>
            </form>
          ) : null}

          {stage === "wallet" && recoveryToken ? (
            <RecoveryWalletStep
              recoveryToken={recoveryToken}
              onConfirmed={(address, locked) => {
                setRecoveredAddress(address);
                setLockedUntil(locked);
                setInfo(
                  "Wallet recovery complete. Your new wallet is now the primary signer.",
                );
                setStage("done");
              }}
              onError={setError}
            />
          ) : null}

          {stage === "done" && recoveredAddress ? (
            <div className="account-form">
              <p className="inline-success">
                <ShieldCheck size={14} /> New primary wallet:{" "}
                <code>{recoveredAddress}</code>
              </p>
              <p className="section-helper">
                Recovery is locked again until{" "}
                {lockedUntil
                  ? new Date(lockedUntil).toLocaleString()
                  : "tomorrow"}{" "}
                to limit abuse.
              </p>
              <a className="btn" href="/account">
                Go to account
              </a>
            </div>
          ) : null}

          {info ? <p className="inline-success">{info}</p> : null}
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      </section>
    </div>
  );
}

interface RecoveryWalletStepProps {
  recoveryToken: string;
  onConfirmed: (address: string, lockedUntil: string | null) => void;
  onError: (message: string | null) => void;
}

function RecoveryWalletStep({
  recoveryToken,
  onConfirmed,
  onError,
}: RecoveryWalletStepProps) {
  if (!isWalletConfigured) {
    return (
      <p className="inline-error">
        Wallet sign-in is not configured in this environment.
      </p>
    );
  }
  return (
    <ConnectedRecoveryWalletStep
      recoveryToken={recoveryToken}
      onConfirmed={onConfirmed}
      onError={onError}
    />
  );
}

function ConnectedRecoveryWalletStep({
  recoveryToken,
  onConfirmed,
  onError,
}: RecoveryWalletStepProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);

  const ready = useMemo(
    () => Boolean(isConnected && address),
    [address, isConnected],
  );

  const handleSign = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    onError(null);
    try {
      const challengeRes = await fetch("/api/auth/recovery/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryToken }),
      });
      const challengeBody = (await challengeRes
        .json()
        .catch(() => ({}))) as ChallengeResponse;
      if (!challengeRes.ok || !challengeBody.nonce) {
        throw new Error(
          errorMessage(
            challengeBody.error,
            "Could not start a recovery challenge.",
          ),
        );
      }

      const message = buildRecoverySiweMessage({
        address,
        nonce: challengeBody.nonce,
        chainId: chainId || 1,
      });
      const signature = await signMessageAsync({ message });

      const confirmRes = await fetch("/api/auth/recovery/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryToken, message, signature }),
      });
      const confirmBody = (await confirmRes
        .json()
        .catch(() => ({}))) as ConfirmResponse;
      if (!confirmRes.ok || !confirmBody.walletAddress) {
        throw new Error(
          errorMessage(confirmBody.error, "Recovery could not be confirmed."),
        );
      }
      onConfirmed(
        confirmBody.walletAddress,
        confirmBody.recoveryLockedUntil ?? null,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
    } finally {
      setBusy(false);
    }
  }, [address, chainId, onConfirmed, onError, recoveryToken, signMessageAsync]);

  return (
    <div className="account-form">
      <div className="wallet-signin-actions">
        <ConnectButton />
        {ready ? (
          <button
            className="btn"
            type="button"
            onClick={handleSign}
            disabled={busy}
          >
            <Wallet size={14} />
            {busy ? "Signing..." : "Sign and recover"}
          </button>
        ) : (
          <p className="section-helper">
            Connect the wallet you want to set as your new primary.
          </p>
        )}
      </div>
    </div>
  );
}
