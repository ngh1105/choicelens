import Stripe from "stripe";

let stripeClient: Stripe | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Stripe billing.`);
  }
  return value;
}

export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
  }
  return stripeClient;
}

export function getStripePlusPriceId(): string {
  return requiredEnv("STRIPE_PLUS_PRICE_ID");
}

export function getStripeWebhookSecret(): string {
  return requiredEnv("STRIPE_WEBHOOK_SECRET");
}

export function getAppBaseUrl(): string {
  const value = process.env.APP_BASE_URL?.trim();
  if (!value) return "http://localhost:3000";
  return value.replace(/\/+$/g, "");
}
