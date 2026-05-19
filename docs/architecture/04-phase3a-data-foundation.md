# Phase 3A — Data Foundation

Replaces the JSON file store from Phase 2 with a Prisma-backed relational store. Same public API surface in `src/lib/store.ts`, so route handlers and UI are unchanged.

## Why now

JSON-on-disk gets us through demos but loses concurrency safety, indexing, and any path to a hosted DB. Phase 3A adds that path without committing to auth, payments, or on-chain state.

## Scope

- Prisma schema + client.
- SQLite for local dev, Postgres-ready (swap `provider` and `DATABASE_URL`).
- Anonymous default user — every record belongs to a single auto-created `anon` user. No login.
- No mock GenLayer changes. Receipts still come from `MockGenLayerService`.

## Data model

```
User (id, handle, createdAt)
  └─ Comparison (id, userId, createdAt, input JSON, result JSON)
        ├─ WatchlistEntry (id, userId, comparisonId, optionId, name, score, payloadHash, addedAt)
        │     unique(comparisonId, payloadHash) — re-watching the same pick is idempotent
        └─ Receipt (id, comparisonId UNIQUE, payloadHash, status, network, contractAddress, transactionHash, createdAt)
```

`input` and `result` are stored as serialized JSON strings because SQLite has no native JSON type. The store layer parses on read and stringifies on write — the API contract on the wire is unchanged.

## Local setup

1. Copy env: `cp .env.example .env` (default `DATABASE_URL=file:./dev.db`).
2. Push schema and create the SQLite db: `npm run db:push`.
3. Seed demo data: `npm run db:seed`.
4. `npm run dev`.

To wipe and reseed in one shot: `npm run db:reset` (this is `db push --force-reset` + seed; SQLite-only, dev-only).

Build runs `prisma generate` automatically; manual `npm run db:generate` is only needed if you change `prisma/schema.prisma` mid-session.

If you have a stray `DATABASE_URL` exported at the shell level, Prisma uses that instead of `.env`. Either `unset DATABASE_URL` or pass an explicit absolute path: `DATABASE_URL=file:$PWD/prisma/dev.db npm run db:push`.

## Seed

`prisma/seed.ts` runs through `tsx` (registered via `package.json#prisma.seed`). It upserts the anon user plus one demo `Comparison` ("smartphones, ~$1000"), one `WatchlistEntry` for the top pick, and one mock `Receipt`. The comparison id is fixed (`seed-comparison-phones`) so reseeds are idempotent.

## Anonymous default user

`getDefaultUserId()` in `src/lib/db.ts` upserts a single `User` row with `handle = "anon"` and caches the id for the lifetime of the process. Every store call resolves through it. When auth lands later, swap this for a session-derived id and the rest of the code stays put.

## Files added

- `prisma/schema.prisma` — schema.
- `prisma/seed.ts` — anon user + demo comparison/watchlist/receipt for `db:seed` and `db:reset`.
- `src/lib/db.ts` — Prisma client singleton + anon-user bootstrap.
- `src/lib/store.ts` — rewritten on top of Prisma; same exports as before.

## Promotion path

To move beyond local dev:

1. Change `datasource db.provider` to `postgresql`.
2. Set `DATABASE_URL` to the managed Postgres URL.
3. `npm run db:push` (or switch to `prisma migrate` once schemas stabilize).

The store layer needs no changes — JSON columns become `Json` type opportunistically once Postgres is in.
