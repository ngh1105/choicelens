-- Add wallet-recovery via email OTP.
ALTER TABLE "User" ADD COLUMN "recoveryLockedUntil" TIMESTAMP(3);

CREATE TABLE "EmailOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "recoveryConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailOtp_email_purpose_createdAt_idx" ON "EmailOtp"("email", "purpose", "createdAt");
CREATE INDEX "EmailOtp_userId_purpose_createdAt_idx" ON "EmailOtp"("userId", "purpose", "createdAt");

ALTER TABLE "EmailOtp" ADD CONSTRAINT "EmailOtp_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
