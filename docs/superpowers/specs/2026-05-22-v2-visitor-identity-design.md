# ChoiceLens V2.1 Visitor Identity Design

Date: 2026-05-22
Status: approved for implementation

## 1. Goal

ChoiceLens V2 usage limits are now enforced, but they are still attached to the
single default `anon` user. V2.1 changes user-facing data and usage from global
anonymous state to per-browser visitor state.

The slice keeps the app login-free. It does not add email accounts, wallet auth,
Stripe, checkout, plan management, or account recovery.

## 2. Current Behavior

`src/lib/db.ts` creates or reuses `User(handle="anon")`. Store and usage helpers
derive their `userId` from that default user:

- comparisons are listed and saved for `anon`
- watchlist entries are listed and saved for `anon`
- receipts are owned through `anon` comparisons
- `/api/usage` reports `anon` usage

That makes Free limits technically correct but product-wrong: one active visitor
can consume the shared quota for everyone.

## 3. Target Behavior

Each browser gets an opaque visitor id cookie. Server routes resolve that cookie
to a `User` row and pass the resolved user into store and usage operations.

Visitor A and Visitor B have isolated:

- comparison history
- watchlist
- receipts
- monthly usage counters
- Free plan limits

If a visitor clears cookies or changes browser/device, they become a new visitor.
That is acceptable for this pre-auth slice.

## 4. Visitor Cookie

Cookie name: `cl_visitor`

Cookie value:

- opaque random id generated server-side
- starts with `v_`
- contains only URL-safe lowercase letters, numbers, `_`, and `-`
- short enough for cookie and handle use

Cookie settings:

- `httpOnly: true`
- `sameSite: "lax"`
- `secure: true` in production
- `path: "/"`
- max age: 365 days

The cookie is not readable by frontend JavaScript. The UI does not need it.

## 5. User Mapping

Visitor users use deterministic handles:

```text
visitor:<visitorId>
```

The visitor resolver upserts `User(handle=visitor:<visitorId>)` and returns:

```ts
{
  id: string;
  plan: string;
  visitorId: string;
  isNewVisitor: boolean;
}
```

Unknown visitor ids create a new Free user. Invalid visitor ids are ignored and
rotated to a new visitor id.

The existing `anon` user remains for seed/demo compatibility and historical
production data. New user-facing requests no longer use it as their primary
identity.

## 6. Module Boundaries

### `src/lib/visitor.ts`

Owns visitor cookie parsing, validation, id creation, cookie writing, and user
resolution.

Expected exports:

- `VISITOR_COOKIE_NAME`
- `getOrCreateVisitorUser(request)`
- `applyVisitorCookie(response, visitor)`
- `isValidVisitorId(value)`

The module can depend on `NextRequest`, `NextResponse`, and `prisma`.

### `src/lib/db.ts`

Keeps only Prisma setup and legacy `anon` helpers. The legacy helpers may remain
for seed/tests/admin compatibility but should not be called by user-facing API
routes after this slice.

### `src/lib/store.ts`

Store operations receive `userId` explicitly:

- `listComparisons(userId)`
- `getComparison(userId, id)`
- `saveComparison(userId, args)`
- `listWatchlist(userId)`
- `addWatchlistEntry(userId, args)`
- `removeWatchlistEntry(userId, id)`
- `saveReceipt(userId, args)`
- `getReceiptForComparison(userId, comparisonId)`
- `updateReceiptStatus(userId, args)`

Ownership checks stay inside store operations.

### `src/lib/usage.ts`

Usage operations receive a user explicitly:

- `getUsageSummaryForUser(prisma, user, now?)`
- `getUsageSummary(user, now?)`
- `assertWithinPlanLimitForUser(client, user, feature, now?)`
- `getExistingWatchlistEntryForComparison(userId, comparisonId)`
- `hasReceiptForComparison(userId, comparisonId)`

The existing transaction-safe limit checks remain in place.

## 7. Route Flow

Every user-facing API route starts by resolving the visitor user:

1. Read `cl_visitor` from the request.
2. Validate it.
3. Create a new visitor id if missing or invalid.
4. Upsert the mapped `User`.
5. Run store/usage work with the resolved `user.id`.
6. Build the existing JSON response shape.
7. If a new/rotated visitor was created, attach `Set-Cookie`.

Routes in scope:

- `GET /api/usage`
- `GET /api/comparisons`
- `POST /api/comparisons`
- `GET /api/watchlist`
- `POST /api/comparisons/[id]/watchlist`
- `DELETE /api/watchlist/[id]`
- `GET /api/comparisons/[id]/receipt`
- `POST /api/comparisons/[id]/receipt`
- `GET /api/comparisons/[id]/receipt/build-input`
- `POST /api/comparisons/[id]/receipt/wallet-tx`

Admin routes are out of scope and keep their existing auth model.

## 8. Response Compatibility

API response bodies do not change.

The only visible HTTP change is that first-time or rotated visitors receive:

```http
Set-Cookie: cl_visitor=...
```

Frontend code continues calling the same endpoints. Browser cookie handling does
the identity work.

## 9. Security And Privacy

The visitor id is not authentication. It is a lightweight pre-auth partitioning
key for product state.

Mitigations:

- use high-entropy random ids
- keep the cookie `httpOnly`
- never put email, wallet address, or comparison content in the cookie
- continue enforcing ownership server-side by `userId`
- return not found for cross-visitor resource access

Known limitation: anyone with the cookie can access that visitor's saved state.
Full account auth and recovery are future work.

## 10. Data Migration

No destructive migration is needed.

The schema already has `User.handle` and `User.plan`, so visitor users are
represented without a new table or column. This slice does not require a Prisma
migration.

Existing `anon` data remains in production. New visitors start with empty
history. If preserving the old seeded comparison for new visitors becomes
important later, add an explicit sample-data feature rather than coupling it to
identity.

## 11. Testing

Unit tests:

- valid visitor ids pass validation
- missing cookie creates a visitor and sets `cl_visitor`
- existing valid cookie reuses its mapped user
- invalid cookie rotates to a new visitor

Route/store tests:

- `/api/usage` sets a cookie on first request
- existing cookie does not create a second user
- visitor A usage does not include visitor B data
- visitor A cannot fetch or mutate visitor B comparison/watchlist/receipt
- limit responses still return `402 plan_limit_reached`

Regression gates:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`

## 12. Rollout

1. Ship visitor resolver and explicit-user store/usage helpers.
2. Update user-facing API routes to resolve visitors.
3. Add cookie and isolation tests.
4. Verify locally with two browsers or two cookie jars.
5. Deploy to Vercel.
6. Smoke production:
   - first request gets `Set-Cookie`
   - `/api/usage` returns Free usage for the visitor
   - two different cookie jars have independent usage counts

## 13. Rollback

If visitor identity causes production issues, revert the implementation PR. The
database can keep any `visitor:*` users created during the rollout; they do not
affect the old `anon` path.

## 14. Acceptance Criteria

1. New visitors receive a secure `cl_visitor` cookie.
2. Visitor users are stored as `User(handle="visitor:<id>")`.
3. Comparisons, watchlist, receipts, and usage are isolated per visitor.
4. Cross-visitor access returns not found or no-op delete behavior.
5. Existing API response bodies stay compatible.
6. No login, Stripe, checkout, or account recovery is introduced.
7. Lint, typecheck, build, and tests pass.
