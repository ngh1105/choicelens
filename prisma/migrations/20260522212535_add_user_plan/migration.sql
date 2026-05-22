-- Add user plan metadata for V2 usage gates.
ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
