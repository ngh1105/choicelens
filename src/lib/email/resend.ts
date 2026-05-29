/**
 * Resend email wrapper. Uses fetch directly so we don't add a dep just for one
 * outbound endpoint.
 *
 * Required env:
 *   - RESEND_API_KEY  (re_...)
 *   - RESEND_FROM     (e.g. "ChoiceLens <recovery@choicelens.app>")
 *
 * If RESEND_API_KEY is unset we treat email as disabled. In development this
 * lets us inspect the rendered payload via console without needing a real key.
 */

export class EmailSendError extends Error {
  code: "email_disabled" | "email_send_failed" | "email_invalid_config";
  cause?: unknown;

  constructor(
    code: EmailSendError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "EmailSendError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface ResendResponse {
  id?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendEmail(args: SendEmailArgs): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new EmailSendError(
      "email_disabled",
      "Resend API key is not configured.",
    );
  }
  const from = process.env.RESEND_FROM?.trim();
  if (!from) {
    throw new EmailSendError(
      "email_invalid_config",
      "RESEND_FROM is not configured.",
    );
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new EmailSendError(
      "email_send_failed",
      `Resend rejected request (${response.status}): ${body || "no body"}`,
    );
  }

  const data = (await response.json().catch(() => ({}))) as ResendResponse;
  return { id: data.id ?? "" };
}

export function isEmailSendError(value: unknown): value is EmailSendError {
  return value instanceof EmailSendError;
}
