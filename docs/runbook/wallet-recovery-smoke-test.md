# Wallet recovery smoke test

Use this before deploying wallet recovery changes, especially the unique `User.recoveryEmail` migration.

## Prerequisites

- `DATABASE_URL` points at the target Postgres database and starts with `postgresql://` or `postgres://`.
- `WALLET_SESSION_SECRET` is set.
- Prefer setting a distinct `WALLET_RECOVERY_TOKEN_SECRET` in staging/prod.
- For real email delivery: `RESEND_API_KEY` and `RESEND_FROM` are set. If email is disabled in dev, read OTPs from server logs.
- Test wallet A is the current primary wallet. Test wallet B is not linked to any account.

## DB preflight

```bash
npx tsx scripts/check-duplicate-recovery-emails.ts
npx prisma migrate status
```

Expected:

- Duplicate check prints `No duplicate recoveryEmail values found.`
- Prisma reports migrations are applied or pending as expected.

If duplicates exist, clear or move `recoveryEmail` on the non-owner rows before applying `20260528130000_unique_recovery_email`.

## Migration

Dev/staging:

```bash
npm run db:migrate
```

Production-style deploy:

```bash
npm run db:deploy
```

## Manual E2E flow

1. Sign in with wallet A.
2. Open `/account`.
3. Save a recovery email.
4. Send verification code.
5. Confirm the 6-digit code.
6. Confirm account shows recovery email verified.
7. Clear browser session or use another browser profile.
8. Open `/recover`.
9. Enter the verified recovery email and request a recovery code.
10. Enter the 6-digit recovery code.
11. Connect wallet B.
12. Sign the recovery SIWE message.
13. Confirm recovery completes.

## Expected results

- `User.primaryWalletAddress` is wallet B.
- `User.recoveryLockedUntil` is about 24 hours in the future.
- The `EmailOtp` row used for recovery has `consumedAt` and `recoveryConfirmedAt` set.
- The recovery `WalletLinkRequest` row has `status = "recovery_confirmed"` and `confirmedAt` set.
- Browser has `cl_wallet_session` set.
- Browser has no `cl_visitor` cookie after recovery.
- Wallet A can no longer sign in as this account's primary wallet.
- A second recovery attempt during cooldown is refused/silently no-ops as designed.

## Useful SQL checks

```sql
select id, handle, "primaryWalletAddress", "recoveryEmail", "recoveryEmailVerifiedAt", "recoveryLockedUntil"
from "User"
where "recoveryEmail" = 'test@example.com';

select id, purpose, email, attempts, "consumedAt", "recoveryConfirmedAt", "createdAt"
from "EmailOtp"
where email = 'test@example.com'
order by "createdAt" desc
limit 5;

select id, "requestedWalletAddress", status, "expiresAt", "confirmedAt", "createdAt"
from "WalletLinkRequest"
where "userId" = '<user id>'
order by "createdAt" desc
limit 5;
```
