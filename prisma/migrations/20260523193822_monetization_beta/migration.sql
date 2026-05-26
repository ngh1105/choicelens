-- Add wallet-first paid identity and Stripe subscription metadata.
ALTER TABLE "User" ADD COLUMN "primaryWalletAddress" TEXT;
ALTER TABLE "User" ADD COLUMN "walletLinkedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "recoveryEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "recoveryEmailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "User" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "User" ADD COLUMN "stripeSubscriptionStatus" TEXT;
ALTER TABLE "User" ADD COLUMN "stripeCurrentPeriodEnd" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_primaryWalletAddress_key" ON "User"("primaryWalletAddress");
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");

CREATE TABLE "WalletLinkRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedWalletAddress" TEXT NOT NULL,
    "challengeNonce" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "WalletLinkRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletLinkRequest_userId_status_expiresAt_idx" ON "WalletLinkRequest"("userId", "status", "expiresAt");
CREATE INDEX "WalletLinkRequest_requestedWalletAddress_idx" ON "WalletLinkRequest"("requestedWalletAddress");

ALTER TABLE "WalletLinkRequest" ADD CONSTRAINT "WalletLinkRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);
