import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src/app/api/billing/checkout/route.ts",
  "src/app/api/billing/portal/route.ts",
  "src/app/api/billing/webhook/route.ts",
  "src/lib/billing/stripe.ts",
  "src/lib/billing/subscriptions.ts",
  "docs/runbook/monetization-beta-smoke.md",
  "prisma/migrations/20260523193822_monetization_beta/migration.sql",
];

const requiredEnvDocs = [
  "APP_BASE_URL",
  "BILLING_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PLUS_PRICE_ID",
  "WALLET_SESSION_SECRET",
  "DATABASE_URL",
];

const requiredWebhookEvents = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const requiredChecklistTerms = [
  "Checkout",
  "Billing Portal",
  "webhook replay",
  "subscription update/delete",
  "downgrade/cancel",
  "failed webhook recovery",
];

let failures = 0;

function pass(message: string): void {
  console.log(`PASS ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.error(`FAIL ${message}`);
}

function warn(message: string): void {
  console.warn(`WARN ${message}`);
}

function readRequired(relativePath: string): string {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`${relativePath} exists`);
    return "";
  }
  pass(`${relativePath} exists`);
  return readFileSync(absolutePath, "utf8");
}

console.log("Stripe paid-beta smoke readiness (local-safe, no network)\n");

const contents = new Map<string, string>();
for (const file of requiredFiles) {
  contents.set(file, readRequired(file));
}

const envExample = readRequired(".env.example");
for (const name of requiredEnvDocs) {
  envExample.includes(`${name}=`)
    ? pass(`.env.example documents ${name}`)
    : fail(`.env.example documents ${name}`);
}

const runbook = contents.get("docs/runbook/monetization-beta-smoke.md") ?? "";
for (const eventName of requiredWebhookEvents) {
  runbook.includes(eventName)
    ? pass(`runbook includes ${eventName}`)
    : fail(`runbook includes ${eventName}`);
}
for (const term of requiredChecklistTerms) {
  runbook.toLowerCase().includes(term.toLowerCase())
    ? pass(`runbook covers ${term}`)
    : fail(`runbook covers ${term}`);
}

const checkout = contents.get("src/app/api/billing/checkout/route.ts") ?? "";
const portal = contents.get("src/app/api/billing/portal/route.ts") ?? "";
const webhook = contents.get("src/app/api/billing/webhook/route.ts") ?? "";
const subscriptions = contents.get("src/lib/billing/subscriptions.ts") ?? "";

checkout.includes("mode: \"subscription\"")
  ? pass("checkout creates subscription-mode sessions")
  : fail("checkout creates subscription-mode sessions");
checkout.includes("subscription_data") && checkout.includes("walletAddress")
  ? pass("checkout attaches minimal subscription metadata")
  : fail("checkout attaches minimal subscription metadata");
portal.includes("billingPortal.sessions.create")
  ? pass("billing portal route creates Stripe portal sessions")
  : fail("billing portal route creates Stripe portal sessions");
webhook.includes("constructEvent") && webhook.includes("getStripeWebhookSecret")
  ? pass("webhook verifies Stripe signatures")
  : fail("webhook verifies Stripe signatures");
webhook.includes("duplicate") && webhook.includes("isRetryableWebhookStatus")
  ? pass("webhook has idempotency + failed/stale retry path")
  : fail("webhook has idempotency + failed/stale retry path");
subscriptions.includes("customer.subscription.deleted")
  ? warn("subscription library should not contain route event switches; inspect route instead")
  : pass("subscription state handlers are separated from route event switch");
subscriptions.includes("past_due") && subscriptions.includes("unpaid")
  ? pass("failed-payment statuses downgrade to Free")
  : fail("failed-payment statuses downgrade to Free");

const envSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!envSecretKey) {
  pass("STRIPE_SECRET_KEY is unset for this local-safe check");
} else if (envSecretKey.startsWith("sk_test_")) {
  pass("STRIPE_SECRET_KEY appears to be test-mode");
} else if (envSecretKey.startsWith("sk_live_")) {
  fail("STRIPE_SECRET_KEY is live-mode; do not run paid-beta smoke with live secrets here");
} else {
  warn("STRIPE_SECRET_KEY is set but does not look like a Stripe secret key");
}

if (failures > 0) {
  console.error(`\nStripe smoke readiness failed: ${failures} issue(s).`);
  process.exit(1);
}

console.log("\nStripe smoke readiness checks passed. External Stripe smoke still requires test-mode secrets and manual checkout/portal actions from the runbook.");
