# ChoiceLens UI Refresh — Implementation Plan (Draft)

Date: 2026-05-21
Status: draft, awaiting `APPROVE DESIGN`
Branch (docs): `codex/opendesign-ui-refresh-design`
Branch (impl, future): `codex/opendesign-ui-refresh`
Spec: [`docs/superpowers/specs/2026-05-21-opendesign-ui-refresh-design.md`](../specs/2026-05-21-opendesign-ui-refresh-design.md)

This plan is **not** approval to implement. It exists so the implementation
PR can land within the constraints already agreed in the spec, with no
further interpretation needed.

---

## 0. Preconditions

- Spec approved (`APPROVE DESIGN`).
- `master` is at the deploy of record (currently `9400ea8`).
- Prod health is green (`studionet_configured`).
- Preview env vars are set (currently 9/9).
- Local: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm run build`,
  `npm test` all run cleanly on master before any change.

If any precondition fails, stop and report; do not start implementation.

## 1. Branch Strategy

- Docs PR: `codex/opendesign-ui-refresh-design` (this PR, docs-only).
- Impl PR: `codex/opendesign-ui-refresh`, branched off `master` after the
  docs PR merges and `APPROVE DESIGN` is given.
- No squashed history rewrites. Each meaningful step commits separately.

## 2. Step-by-Step Implementation

### Step 1 — Tokens (CSS only)
**File:** `src/app/globals.css`

- Add new tokens listed in spec §4 inside `:root`.
- Add `@media (prefers-reduced-motion: no-preference)` wrapper section that
  defines the keyframes used in later steps (`pulse`, `barFill`, `panelEnter`).
- Verify nothing existing changes: run `npm run build` and diff resulting
  HTML for `/` between master and branch.

Acceptance: existing visual unchanged in this commit.

### Step 2 — Sticky header polish
**File:** `src/app/globals.css`

- Add `backdrop-filter: blur(8px)` and `position: sticky; top: 0; z-index: 10`
  to `.app-header` with a fallback to solid `--bg-elev` via
  `@supports not (backdrop-filter: blur(8px))`.
- Add `border-bottom-color: var(--border-hairline)` for the hairline rule.
- No JSX changes.

Acceptance: header stays at top during scroll, doesn't flash on Windows
Chromium.

### Step 3 — Hero `TopPick`
**Files:** `src/app/globals.css`, `src/app/page.tsx`

- Promote `.top-pick` to hero card: `background: var(--bg-elev-3)`, gradient
  border via `border-image` with fallback solid `--accent-soft`,
  `box-shadow: var(--shadow-lift)`.
- In `page.tsx`, in `TopPick` component:
  - Change top-pick name font-size from 16 → 20px (use class, not inline).
  - Move score chip into a `.top-pick-score-chip` with mono 22px.
  - Add a single-line "Strongest combined read across 5 analysts" helper
    above the action row (already present, just promote visually).
- No new state or props.

Acceptance: top pick dominates result panel; score table and signals
unchanged in markup.

### Step 4 — Score table polish
**Files:** `src/app/globals.css`, `src/app/page.tsx`

- CSS only: zebra striping, row hover background, gradient score-bar fill,
  width animation from `0%` to `var(--bar-width)` via CSS variable.
- In `ScoreTable`, set inline `style={{ '--bar-width': `${s?.score ?? 0}%` }}`
  on the bar fill span (this is a CSS variable, not a layout style; it's
  the only way to drive the keyframe per-row).

Acceptance: bars animate in once on result render; subsequent re-renders
do not re-animate.

### Step 5 — Signals
**File:** `src/app/globals.css`

- Confidence bar gets gradient fill using `--accent-grad`.
- No JSX change.

Acceptance: confidence bar visually distinct from score bars.

### Step 6 — Receipt card polish
**Files:** `src/components/receipt/ReceiptCard.tsx`,
`src/components/receipt/ReceiptStatusPill.tsx`,
`src/app/globals.css`

- Add `data-pulse="true"` on `ReceiptStatusPill` when status is
  `pending` or `accepted`. CSS keys off `[data-pulse="true"]` for the
  pulse animation. Terminal states get no `data-pulse`.
- In `ReceiptCard.tsx`, add small copy-to-clipboard buttons next to the
  `id`, `payloadHash`, and `transactionHash` rows. Use `navigator.clipboard`
  and a 1500ms "copied" state. No new state library, no new dependency.
- All buttons have `aria-label`s and visible focus rings.

Acceptance: pending receipts pulse; copy buttons work and announce success;
existing test for `ReceiptStatusPill` stays green.

### Step 7 — Admin page de-inline
**File:** `src/app/admin/genlayer/page.tsx`

- Remove every inline `style={{...}}`. Replace with classes added to
  `globals.css`:
  - `.admin-shell`, `.admin-h1`, `.admin-helper`
  - `.admin-config-grid` (replaces inline grid)
  - `.admin-counts-grid`, `.admin-count-tile` with tone modifier classes
    `--ok / --warn / --danger`
  - `.admin-errors-list`, `.admin-errors-row`
- Add a status strip above the operator-state panel: a 4px tall bar that
  takes a tone class derived from `STATE_PILL[snapshot.operatorState].tone`.
- Make the count tiles use a top-border colour matched to whether the count
  represents a healthy or unhealthy bucket (`finalized` ok; `failed`,
  `finalized_with_error` warn; others neutral).

Acceptance: no `style={{...}}` remains; visual reads as a console.

### Step 8 — Reduced-motion gate audit
**File:** `src/app/globals.css`

- Confirm every keyframe and `transition: ...` rule that is purely
  decorative is wrapped in `@media (prefers-reduced-motion: no-preference)`.
- Hover transitions on buttons (functional feedback) stay outside the gate.

Acceptance: with `Emulate CSS prefers-reduced-motion: reduce` set in
devtools, no animations run on `/` or `/admin/genlayer`.

### Step 9 — Verification
Run all four gates and the local browser smoke from spec §8. Fix anything
that breaks before pushing.

### Step 10 — Push, PR, CI, merge
- Push branch with `-u`.
- Open PR titled `feat(ui): calm premium decision workspace refresh`.
- Body: link to spec + plan, screenshots before/after for `/` populated,
  `/` empty, receipt pending, `/admin/genlayer`.
- Wait for CI checks.
- Auto-merge if green; `gh pr merge --admin --squash` only if a non-blocking
  review is the sole gate (per user instruction, this is allowed).

### Step 11 — Prod deploy
- Vercel redeploys prod on merge to master automatically.
- Smoke prod per spec §8 prod section.

## 3. File Diff Budget

| File | Lines added (max) |
|---|---|
| `src/app/globals.css` | ~250 |
| `src/app/page.tsx` | ~30 (JSX class string changes only) |
| `src/app/admin/genlayer/page.tsx` | -120 inline styles, +60 class-based markup |
| `src/components/receipt/ReceiptCard.tsx` | ~40 (copy buttons + state) |
| `src/components/receipt/ReceiptStatusPill.tsx` | ~3 (`data-pulse`) |

Anything beyond this budget is a sign that scope creep is happening; pause
and re-confirm.

## 4. Risks & Rollback

- **Risk:** A copy-button focus ring breaks visual rhythm.
  **Mitigation:** Use `:focus-visible` only; tab-key smoke test in dev.
- **Risk:** Gradient `border-image` breaks on Safari/iOS at small radii.
  **Mitigation:** `@supports (border-image: linear-gradient(...) 1)` guard;
  fallback to solid `--accent-soft` border.
- **Risk:** Animation timing makes the score table feel slow on low-end
  hardware.
  **Mitigation:** Stagger capped at 60ms × 3 rows = 180ms total; total time
  under 600ms regardless.
- **Rollback:** This is a non-functional change. If anything regresses on
  prod, revert the merge commit; no data migration is involved.

## 5. Out-of-Scope Reminders

- No new dependencies. (No `framer-motion`, `tailwind`, `panda`, `radix`.)
- No copy changes beyond labels strictly required by the new layout.
- No route additions.
- No new tests for visuals; existing tests stay green.
- No Storybook, no Playwright additions.
- No `/admin/genlayer` data shape changes.

## 6. Definition of Done

The implementation PR is done when:

1. All four quality gates green (`lint`, `typecheck`, `build`, `test`).
2. Local browser smoke per spec §8 passes.
3. PR review (or `--admin` if review is the only blocker) approves.
4. Merged to master.
5. Vercel prod deploy succeeds.
6. Prod smoke per spec §8 passes.
7. Final report posted with: screenshots, deploy URL, prod health, git
   status, commit hashes, PR link.

---

**Plan is draft. Implementation begins only after `APPROVE DESIGN`.**
