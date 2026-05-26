"use client";

import { FormEvent, useState } from "react";
import { Mail, Save } from "lucide-react";

interface RecoveryEmailFormProps {
  initialEmail: string | null;
  onSaved: (email: string | null) => void;
}

interface RecoveryResponse {
  recoveryEmail?: string | null;
  error?: string;
}

export function RecoveryEmailForm({
  initialEmail,
  onSaved,
}: RecoveryEmailFormProps) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const recoveryEmail = email.trim() || null;
      const response = await fetch("/api/account/recovery-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryEmail }),
      });
      const body = (await response.json().catch(() => ({}))) as RecoveryResponse;
      if (!response.ok) {
        throw new Error(body.error || "Recovery email could not be saved.");
      }
      const savedEmail = body.recoveryEmail ?? recoveryEmail;
      setEmail(savedEmail ?? "");
      onSaved(savedEmail);
      setMessage("Recovery email saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form" onSubmit={handleSubmit}>
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
      <p className="section-helper">Email is for account recovery only, not login.</p>
      <button className="btn" type="submit" disabled={busy}>
        <Save size={14} />
        {busy ? "Saving..." : "Save recovery email"}
      </button>
      {message ? <p className="inline-success">{message}</p> : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </form>
  );
}
