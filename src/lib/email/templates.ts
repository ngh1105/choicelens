import { sendEmail } from "@/lib/email/resend";

interface SendOtpArgs {
  to: string;
  code: string;
  expiresAt: Date;
  appName?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ttlMinutes(expiresAt: Date): number {
  return Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
}

export async function sendRecoveryOtpEmail(
  args: SendOtpArgs,
): Promise<{ id: string }> {
  const appName = args.appName ?? "ChoiceLens";
  const minutes = ttlMinutes(args.expiresAt);
  const subject = `${appName} wallet recovery code: ${args.code}`;
  const text = [
    `Your ${appName} wallet recovery code is: ${args.code}`,
    "",
    `This code expires in ${minutes} minute(s). It can only be used once.`,
    "",
    "If you did not request this, you can ignore this email. No action will be taken without the code plus a signature from your new wallet.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;max-width:480px;margin:0 auto;padding:24px 16px;">
      <h1 style="font-size:18px;margin:0 0 16px;">${escapeHtml(appName)} wallet recovery</h1>
      <p style="margin:0 0 12px;">Use this code to continue recovering access to your account:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:600;margin:24px 0;text-align:center;background:#f1f5f9;padding:16px;border-radius:8px;">${escapeHtml(args.code)}</p>
      <p style="margin:0 0 8px;color:#475569;">This code expires in ${minutes} minute(s) and can only be used once.</p>
      <p style="margin:16px 0 0;color:#475569;">If you did not request this, you can ignore the email. No change happens without both this code and a fresh signature from a wallet you control.</p>
    </div>
  `.trim();

  return sendEmail({ to: args.to, subject, html, text });
}

export async function sendEmailVerifyOtpEmail(
  args: SendOtpArgs,
): Promise<{ id: string }> {
  const appName = args.appName ?? "ChoiceLens";
  const minutes = ttlMinutes(args.expiresAt);
  const subject = `${appName} email verification code: ${args.code}`;
  const text = [
    `Your ${appName} email verification code is: ${args.code}`,
    "",
    `Enter this code in ${appName} to confirm this address as your recovery email.`,
    `This code expires in ${minutes} minute(s).`,
    "",
    "Your recovery email is only used if you ever lose access to your wallet. It can never log in by itself.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;max-width:480px;margin:0 auto;padding:24px 16px;">
      <h1 style="font-size:18px;margin:0 0 16px;">${escapeHtml(appName)} recovery email verification</h1>
      <p style="margin:0 0 12px;">Use this code to confirm this address as your recovery email:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:600;margin:24px 0;text-align:center;background:#f1f5f9;padding:16px;border-radius:8px;">${escapeHtml(args.code)}</p>
      <p style="margin:0 0 8px;color:#475569;">This code expires in ${minutes} minute(s) and can only be used once.</p>
      <p style="margin:16px 0 0;color:#475569;">Your recovery email is only used if you ever lose access to your wallet. It can never log in by itself.</p>
    </div>
  `.trim();

  return sendEmail({ to: args.to, subject, html, text });
}
