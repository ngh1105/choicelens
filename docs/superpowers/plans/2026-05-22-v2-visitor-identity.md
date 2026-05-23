# ChoiceLens V2.1 Visitor Identity — Implementation Plan

Date: 2026-05-22
Status: approved for implementation
Branch: `codex/v2-visitor-identity`
Spec: [`docs/superpowers/specs/2026-05-22-v2-visitor-identity-design.md`](../specs/2026-05-22-v2-visitor-identity-design.md)

This plan changes usage and saved data from one shared `anon` user to a
per-browser visitor user backed by an HTTP-only cookie. It does not add auth,
Stripe, checkout, account recovery, or schema changes.

## 0. Preconditions

- Start from `master` after PR #22.
- Keep the existing untracked note
  `docs/superpowers/plans/2026-05-21-ui-refresh-followup.md` untouched unless
  the user explicitly asks to include it.
- No Prisma migration is expected for this slice.
- Full verification at the end:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

## 1. File Scope

| File | Change |
|---|---|
| `src/lib/visitor.ts` | New visitor cookie/user resolver |
| `src/lib/__tests__/visitor.test.ts` | New visitor validation/cookie tests |
| `src/lib/store.ts` | Accept explicit `userId` |
| `src/lib/usage.ts` | Accept explicit user/userId in public helpers |
| `src/lib/__tests__/usage.test.ts` | Update mocks and add isolation coverage |
| `src/app/api/**/route.ts` | Resolve visitor and pass `userId` |
| Existing route tests | Assert cookie behavior and ownership isolation |
| `src/app/page.tsx` | No expected change |
| `prisma/schema.prisma` | No expected change |

Avoid changing UI layout, plan limits, billing copy, GenLayer service internals,
or comparison scoring.

## 2. Step-By-Step

### Step 1 — Visitor Resolver

Files:

- Add `src/lib/visitor.ts`
- Add `src/lib/__tests__/visitor.test.ts`

Tasks:

- Define `VISITOR_COOKIE_NAME = "cl_visitor"`.
- Generate ids with `crypto.randomUUID()` converted to a URL-safe `v_...`
  value.
- Validate only `v_` ids with lowercase letters, numbers, `_`, and `-`.
- `getOrCreateVisitorUser(request)`:
  - read cookie from `NextRequest`
  - rotate missing/invalid values
  - upsert `User(handle="visitor:<id>")`
  - select `{ id, plan }`
  - return visitor metadata including whether a cookie should be written
- `applyVisitorCookie(response, visitor)`:
  - only write when missing/rotated/new cookie is needed
  - `httpOnly`, `sameSite: "lax"`, `secure` in production, `path: "/"`
  - max age: 365 days

Acceptance:

- Visitor unit tests cover valid, invalid, and cookie-setting behavior.
- No secrets or user content are stored in cookies.

### Step 2 — Explicit Store User

Files:

- Modify `src/lib/store.ts`

Tasks:

- Replace internal `getDefaultUserId()` calls with explicit `userId` parameters.
- Keep existing ownership checks in the store.
- Preserve serializable transactions and V2 limit checks.
- Do not change response mapping functions.

Acceptance:

- Store callers cannot accidentally fall back to `anon`.
- TypeScript catches any route not passing `userId`.

### Step 3 — Explicit Usage User

Files:

- Modify `src/lib/usage.ts`
- Update `src/lib/__tests__/usage.test.ts`

Tasks:

- Export a public summary helper that accepts `{ id, plan }`.
- Keep transaction helper `assertWithinPlanLimitForUser(client, user, feature)`.
- Update idempotency helpers:
  - `getExistingWatchlistEntryForComparison(userId, comparisonId)`
  - `hasReceiptForComparison(userId, comparisonId)`
- Remove user-facing dependency on `getDefaultUser()` and `getDefaultUserId()`.

Acceptance:

- Usage tests verify counts are scoped to the passed user.
- Plan limit payload shape remains unchanged.

### Step 4 — Route Visitor Wiring

Files:

- `src/app/api/usage/route.ts`
- `src/app/api/comparisons/route.ts`
- `src/app/api/watchlist/route.ts`
- `src/app/api/watchlist/[id]/route.ts`
- `src/app/api/comparisons/[id]/route.ts`
- `src/app/api/comparisons/[id]/watchlist/route.ts`
- `src/app/api/comparisons/[id]/receipt/route.ts`
- `src/app/api/comparisons/[id]/receipt/build-input/route.ts`
- `src/app/api/comparisons/[id]/receipt/wallet-tx/route.ts`

Tasks:

- Change route handlers to accept `NextRequest` where they need cookies.
- Resolve visitor once near the top of each handler.
- Pass `visitor.user.id` or the visitor user object to store/usage helpers.
- Wrap JSON responses with `applyVisitorCookie`.
- Preserve all existing error response shapes and status codes.

Acceptance:

- First request to any user-facing route can set `cl_visitor`.
- Existing valid cookie does not rotate.
- Invalid cookie rotates.
- Admin routes are untouched.

### Step 5 — Route Tests

Files:

- Update existing route tests under `src/app/api/**/__tests__`
- Add focused cases where needed

Tasks:

- Mock visitor resolver where tests are unit-style.
- Add integration-style checks for:
  - `/api/usage` no cookie sets `cl_visitor`
  - valid cookie does not rotate
  - invalid cookie rotates
  - visitor A cannot access visitor B comparison receipt/build-input/watchlist
  - usage limits still return `402 plan_limit_reached`

Acceptance:

- Targeted route tests pass.
- Existing tests still assert the same response bodies.

### Step 6 — Local Smoke

Run dev with a valid database, then smoke with two cookie jars:

```bash
curl -i http://localhost:3000/api/usage
curl -c jar-a.txt -b jar-a.txt http://localhost:3000/api/usage
curl -c jar-b.txt -b jar-b.txt http://localhost:3000/api/usage
```

Then create a comparison with jar A and confirm jar B usage remains unchanged.
Delete temporary cookie jar files afterward.

## 3. Final Verification

Run:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Expected:

- all gates green
- working tree contains only intended tracked changes plus the pre-existing
  untracked UI follow-up note

## 4. PR Checklist

- Push `codex/v2-visitor-identity`.
- Open PR titled `feat(v2): isolate usage by visitor`.
- PR body includes:
  - cookie behavior
  - per-visitor isolation summary
  - no schema migration note
  - test output
  - non-goals: no auth, no Stripe
- Wait for CI and Vercel preview.
- Merge only when green.

## 5. Risk And Rollback

Risks:

- **Cookie resolver accidentally rotates valid users.**
  Mitigation: strict unit tests for validation and non-rotation.
- **A route still uses `anon`.**
  Mitigation: remove user-facing default-user calls from store/usage signatures
  so typecheck catches missing user wiring.
- **Historical `anon` data disappears from new visitor UI.**
  Mitigation: accepted for this slice; future sample data should be explicit.
- **Visitor cookie is mistaken for auth.**
  Mitigation: document it as a partition key only and keep auth out of scope.

Rollback:

- Revert the implementation PR.
- Any `visitor:*` users created during rollout can remain harmlessly.

## 6. Definition Of Done

1. New visitors receive `cl_visitor`.
2. Returning visitors keep the same user.
3. Invalid visitor cookies rotate safely.
4. Usage, comparisons, watchlist, and receipts are per visitor.
5. Cross-visitor access is blocked by existing not-found/no-op behavior.
6. No schema migration, auth, Stripe, or UI redesign is introduced.
7. Lint, typecheck, build, and tests pass.

