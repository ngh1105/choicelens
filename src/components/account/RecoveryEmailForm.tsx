"use client";

import { FormEvent, useState } from "react";
import { Mail, Save, ShieldCheck, ShieldAlert } from "lucide-react";

interface SavedPayload {
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: string | null;
}

interface RecoveryEmailFormProps {
  initialEmail: string | null;
  verifiedAt?: string | null;
  onSaved: (payload: SavedPayload) => void;
}

interface SaveResponse {
  recoveryEmail?: string | null;
  error?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  recovery_email_invalid: "Enter a valid recovery email address.",
  recovery_email_already_used:
    "This recovery email is already used by another account.",
  account_not_found: "Account was not found. Refresh and try again.",
  wallet_session_required: "Sign in with your wallet and try again.",
  otp_invalid_or_expired: "That code is incorrect or expired. Request a new code.",
  otp_rate_limited: "Too many codes requested. Try again later.",
  otp_locked: "Too many incorrect attempts. Request a new code.",
  internal_error: "Something went wrong. Try again later.",
};

function errorMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}

interface VerifyRequestResponse {
  delivered?: boolean;
  expiresAt?: string;
  error?: string;
}

interface VerifyConfirmResponse {
  recoveryEmail?: string;
  recoveryEmailVerifiedAt?: string;
  error?: string;
}

export function RecoveryEmailForm({
  initialEmail,
  verifiedAt: initialVerifiedAt = null,
  onSaved,
}: RecoveryEmailFormProps) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [savedEmail, setSavedEmail] = useState<string | null>(initialEmail);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(
    initialVerifiedAt ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [verifyStage, setVerifyStage] = useState<"idle" | "sent">("idle");
  const [code, setCode] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const trimmedEmail = email.trim() || null;
  const dirty = trimmedEmail !== savedEmail;
  const canVerify =
    !!savedEmail && !verifiedAt && !dirty && trimmedEmail === savedEmail;

  function clearVerifyMessages(): void {
    setVerifyMessage(null);
    setVerifyError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    clearVerifyMessages();
    setVerifyStage("idle");
    setCode("");
    try {
      const recoveryEmail = trimmedEmail;
      const response = await fetch("/api/account/recovery-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryEmail }),
      });
      const body = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok) {
        throw new Error(
          errorMessage(body.error, "Recovery email could not be saved."),
        );
      }
      const next = body.recoveryEmail ?? recoveryEmail;
      setEmail(next ?? "");
      setSavedEmail(next ?? null);
      // Save resets verification when email actually changed.
      const nextVerifiedAt = next === savedEmail ? verifiedAt : null;
      setVerifiedAt(nextVerifiedAt);
      onSaved({ recoveryEmail: next ?? null, recoveryEmailVerifiedAt: nextVerifiedAt });
      setMessage("Recovery email saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    setVerifyBusy(true);
    clearVerifyMessages();
    try {
      const response = await fetch(
        "/api/account/recovery-email/verify/request",
        { method: "POST" },
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as VerifyRequestResponse;
      if (!response.ok) {
        throw new Error(
          errorMessage(body.error, "Verification code could not be sent."),
        );
      }
      setVerifyStage("sent");
      setVerifyMessage(
        body.delivered
          ? "Verification code sent. Check your inbox."
          : "Verification code issued. (Email delivery is disabled in this environment; check server logs for the code.)",
      );
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyBusy(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerifyBusy(true);
    clearVerifyMessages();
    try {
      const response = await fetch(
        "/api/account/recovery-email/verify/confirm",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: code.trim() }),
        },
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as VerifyConfirmResponse;
      if (!response.ok || !body.recoveryEmailVerifiedAt) {
        throw new Error(errorMessage(body.error, "Code could not be verified."));
      }
      setVerifiedAt(body.recoveryEmailVerifiedAt);
      setVerifyStage("idle");
      setCode("");
      setVerifyMessage("Recovery email verified.");
      onSaved({
        recoveryEmail: body.recoveryEmail ?? savedEmail,
        recoveryEmailVerifiedAt: body.recoveryEmailVerifiedAt,
      });
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyBusy(false);
    }
  }

  return (
    <div className="account-form">
      <form onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Recovery email</span>
          <span className="account-input-row">
            <Mail size={14} />
            <input
              className="text-input"
              type="email"
              value={email}
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </span>
        </label>
        <p className="section-helper">
          Email is for account recovery only, not login. You must verify it
          before it can be used to recover access.
        </p>
        <button className="btn" type="submit" disabled={busy}>
          <Save size={14} />
          {busy ? "Saving..." : "Save recovery email"}
        </button>
        {message ? <p className="inline-success">{message}</p> : null}
        {error ? <p className="inline-error">{error}</p> : null}
      </form>

      {savedEmail ? (
        <div className="account-verify-row">
          {verifiedAt ? (
            <p className="inline-success">
              <ShieldCheck size={14} /> Recovery email verified.
            </p>
          ) : (
            <>
              <p className="section-helper">
                <ShieldAlert size={14} /> This email is unverified and cannot
                yet recover your account.
              </p>
              {dirty ? (
                <p className="section-helper">
                  Save your changes before sending a verification code.
                </p>
              ) : verifyStage === "idle" ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={handleSendCode}
                  disabled={!canVerify || verifyBusy}
                >
                  {verifyBusy ? "Sending..." : "Send verification code"}
                </button>
              ) : (
                <form className="account-form" onSubmit={handleConfirm}>
                  <label className="field">
                    <span className="field-label">Verification code</span>
                    <input
                      className="text-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="\d{6}"
                      maxLength={6}
                      value={code}
                      placeholder="123456"
                      onChange={(event) =>
                        setCode(event.currentTarget.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                  <button
                    className="btn"
                    type="submit"
                    disabled={verifyBusy || code.length !== 6}
                  >
                    {verifyBusy ? "Verifying..." : "Verify code"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={handleSendCode}
                    disabled={verifyBusy}
                  >
                    Resend code
                  </button>
                </form>
              )}
              {verifyMessage ? (
                <p className="inline-success">{verifyMessage}</p>
              ) : null}
              {verifyError ? (
                <p className="inline-error">{verifyError}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
