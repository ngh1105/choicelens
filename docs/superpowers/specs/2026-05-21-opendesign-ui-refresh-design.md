# ChoiceLens UI/UX Refresh — Design Spec

Date: 2026-05-21
Status: awaiting approval
Owner: project founder
Branch: `codex/opendesign-ui-refresh-design`
Related plan: [`docs/superpowers/plans/2026-05-21-opendesign-ui-refresh.md`](../plans/2026-05-21-opendesign-ui-refresh.md)

---

## 1. Goal

Refresh ChoiceLens's web UI to feel like a premium, focused decision workspace
without changing any product behavior. The current build (master @ `9400ea8`,
prod live at https://choicelens-beta.vercel.app) is functionally complete for
V1: comparison, watchlist, off-chain receipt, optional GenLayer wallet path,
operator health admin. The visuals are correct but flat. This spec defines
three concrete directions, picks one, and feeds an implementation plan that
follows on a separate PR after approval.

## 2. Non-Goals

- No new product features.
- No changes to API routes, schema, store, comparison engine, GenLayer
  service boundary, polling cadence, error taxonomy, or wallet flow.
- No copy or i18n work beyond minor labels.
- No new dependencies beyond `framer-motion` (and only if the recommended
  direction is approved as-is).
- No marketing landing page.
- No mobile app, no extension, no Storybook, no Playwright additions.

## 3. Audited Surfaces

| Surface | File | Highlights |
|---|---|---|
| Root layout | `src/app/layout.tsx` | Plain html/body wrapping `Providers`. No header chrome here. |
| Home `/` | `src/app/page.tsx` (984 lines) | Sticky header + 2-col grid: Composer / Priorities / Constraints / Result on the left, Watchlist / Receipt on the right. Collapses at 1080px. |
| Admin `/admin/genlayer` | `src/app/admin/genlayer/page.tsx` | Server component, mostly inline-styled. Operator-state pill, configuration dl, 24h counts grid, recent errors list. |
| Tokens & component CSS | `src/app/globals.css` (~700 lines) | Dark, blue accent `#6ea8ff`, 14px body, 8px radius, `var(--shadow)` minimal, no motion vars. |
| Receipt card | `src/components/receipt/ReceiptCard.tsx` | Status pill, key/value rows, optional explorer link, error retry. |
| Status pill | `src/components/receipt/ReceiptStatusPill.tsx` | Maps `ReceiptStatus` to one of 6 pill classes. |
| Wallet path | `src/components/receipt/WalletPathToggle.tsx`, `WalletReceiptControls.tsx` | Persistent toggle in localStorage, switches the receipt sign flow. |

### Strengths to preserve
- Correct semantic structure (`<main>`, `<section>`, labels, roles, `aria-label`s).
- Dense but readable info architecture for operators.
- Mono numbers for hashes and scores.
- Working two-column responsive collapse at 1080px.
- Consumer-default language with crypto language present but subordinate.

### Weaknesses to address
- Flat visual hierarchy — every panel weighs the same; the recommendation
  doesn't visually win.
- Score table cramped on narrow viewports.
- Receipt card reads like a config dump, not a finished artifact.
- Admin page mixes inline styles with classes; tone is not encoded
  beyond a single status pill.
- No motion vocabulary for state transitions (pending receipts, score-bar
  reveal, panel entry).

## 4. Design Tokens — Shared Across Directions

Additive only; nothing existing is removed.

```
/* Surfaces */
--bg              keep #0b0d10 (cooler #0a0c10 in B/C only)
--bg-elev         keep #12161b
--bg-elev-2       keep #181d24
--bg-elev-3       new   #1f252e   (focus / top-pick / hero)
--border          keep #232a33
--border-strong   keep #2f3742
--border-hairline new   rgba(255,255,255,0.04)

/* Text */
--text            keep #e6ebf2
--text-soft       keep #b6bdc8
--text-muted      keep #8a93a0

/* Accent */
--accent          keep #6ea8ff
--accent-2        new   #a784ff (already used in brand mark)
--accent-grad     new   linear-gradient(135deg, var(--accent), var(--accent-2))

/* Status (existing) */
--positive #5fbf8a   --warn #d4a14b   --danger #d97766

/* Depth */
--shadow          keep
--shadow-lift     new   0 6px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)

/* Motion */
--motion-fast     new   120ms cubic-bezier(.2,.7,.2,1)
--motion-soft     new   240ms cubic-bezier(.2,.7,.2,1)
--motion-slow     new   400ms cubic-bezier(.2,.7,.2,1)
```

All animation rules wrap in
`@media (prefers-reduced-motion: no-preference)` — reduced-motion users see
the static end state.

## 5. Three Directions

### A. Calm Premium Decision Workspace (Recommended)

#### Visual thesis
A focused workspace where the recommendation visually wins. The shell stays
quiet so the user's choice can speak. Motion is purposeful: state transitions
only, never decoration.

#### Layout map
```
┌─────────────────────────────────────────────────────────────────┐
│ STICKY HEADER  brand · v1 pill              wallet pill · Connect│
│ (blurred, hairline rule, 56px)                                   │
├─────────────────────────────────────┬───────────────────────────┤
│ Composer (panel)                     │ Watchlist (panel)         │
│ Priorities (panel)                   │                           │
│ Constraints (panel)                  ├───────────────────────────┤
│ ┌─ Recommendation (HERO) ──────────┐ │ Receipt (panel)           │
│ │  Top pick — gradient border      │ │  status pill (pulse)      │
│ │  RANK 01 chip                    │ │  copyable hash rows       │
│ │  big mono score                  │ │  inline explorer link     │
│ │  one-line "why"                  │ │                           │
│ │  Save · Open                     │ │                           │
│ └──────────────────────────────────┘ │                           │
│ Score table (zebra, hover row)       │                           │
│ Signals: confidence + uncertainty    │                           │
└─────────────────────────────────────┴───────────────────────────┘
```
Right rail widens to **400px**, gutter 24px. Mobile (<1080px): single
column, hero stays first card after composer; right-rail panels move to
end.

#### Typography
- Body 14.5px, chrome 13px (current 14/13).
- H1 22 → 24px; tracking `-0.01em`.
- Mono for: scores, hashes, network names, score-table cells.
- Top-pick name 16 → 20px; top-pick score 13 → 22px mono.

#### Color
- Reuse existing palette. Promote `--accent-2` from brand-only to: `tag-rank-1`
  border accent, gradient border on hero card, gradient fill on confidence bar.
- Score-bar gradient: `linear-gradient(90deg, var(--accent), var(--accent-2))`.
- Tone tints (3 surfaces only): hero card `--bg-elev-3`, sticky header
  blurred elevation, focused input `border-color: var(--accent)`.

#### Motion
| Element | Trigger | Animation | Duration |
|---|---|---|---|
| Panels | First mount | opacity 0→1, translateY 4px→0 | --motion-soft |
| Score bars | Result render | width 0→value, staggered 60ms | --motion-slow |
| Status pill | Non-terminal status | 1.6s ease-in-out pulse opacity 0.55↔1 | infinite |
| Buttons | Hover | border-color, background | --motion-fast |
| Hero card | First mount | scale 0.99→1, blur 4px→0 | --motion-soft |

Page-load skeletons are **not** added; the existing "Loading saved decisions"
text stays.

#### Mobile behavior
- Sticky header collapses brand + wallet pill into a 56px bar; Connect button
  shrinks to icon-only at <480px.
- Hero card score moves below the name on <480px.
- Score table becomes horizontally scrollable inside the card with a soft
  fade gradient on the right edge.
- Watchlist + Receipt panels stack below result on mobile.

#### Risk
- Backdrop-filter blur on Windows Chromium has occasional jitter — falls back
  to solid `--bg-elev` when `prefers-reduced-transparency: reduce`.
- Gradient border on hero card uses `border-image` which has Safari quirks at
  small radii — fallback solid `--accent-soft` border.

---

### B. Consumer / Editorial Decision Assistant

#### Visual thesis
Looks closer to a high-quality editorial review site (Wirecutter, Strategist).
Trades operator density for legibility and confidence. Suitable if ChoiceLens
moves toward acquisition and freemium funnel rather than power users.

#### Layout map
```
┌────────────────────────────────────────────────────────────────┐
│ TOP NAV  brand · "Compare" · "Watchlist"      wallet · Connect  │
├────────────────────────────────────────────────────────────────┤
│ ┌── Decision header ──────────────────────────────────────────┐ │
│ │  "Compare these laptops..." (h1, 28px, serif)                │ │
│ │  3 priorities chips · "8 minutes"                            │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌── Top pick card (full width) ──────────────────────────────┐ │
│ │  big name · score · 2-line summary · CTA cluster             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ Shortlist (3 cards in a row, image-optional)                     │
│ Trade-offs · Avoid-if · What would change                        │
│ ── thin rule ──                                                  │
│ Watchlist + Receipt collapsed by default                         │
└────────────────────────────────────────────────────────────────┘
```
Single content column, 720–840px wide, centered. Right rail collapses to a
sticky bottom-right summary chip on desktop and disappears on mobile.

#### Typography
- Body 16px (up from 14).
- Headings: optional serif (Newsreader / Source Serif) at 28/22/18; sans
  fallback if user disables web fonts.
- Mono only for hash/tx values, never for scores.

#### Color
- Lighter dark mode (`--bg #0d1117`).
- Accent shifts toward warm: `--accent #f0b48a` (amber). Status colors keep.
- Score-bars become solid amber on neutral track.

#### Motion
- Soft 320ms entrance on each major card.
- Score-bar grow on first reveal.
- No status pulse (would look out of place against editorial tone).

#### Mobile behavior
- Single column at every breakpoint.
- Top pick card pinned, "Open" CTA becomes sticky on scroll past it.

#### Risk
- Serif typography requires a webfont (Google Fonts adds 1 RTT on cold load).
- Larger body type pushes operator data (admin page, recent errors, hashes)
  into uncomfortably large rows. Operator surfaces would need a separate
  "compact" override.
- Drift from current operator workflow muscle memory.

---

### C. Dense Operator / Productivity Console

#### Visual thesis
Treats ChoiceLens like a Linear/Height/Superhuman workspace. Maximum
information per pixel, keyboard-first, dense. Suitable if the primary user
becomes a power user running many comparisons per session.

#### Layout map
```
┌────────────────────────────────────────────────────────────────┐
│ COMMAND BAR  ⌘K · brand · breadcrumbs           ws status · me  │
├──────┬─────────────────────────────────────┬───────────────────┤
│ NAV  │ Composer (collapsible)               │ Watchlist (live)   │
│ side │ Priorities (drawer, ⌘P)              │ Receipt (live)     │
│ rail │ Constraints (drawer, ⌘D)             │ Audit feed         │
│ 56px │ ─────────────────────────────────── │                   │
│      │ Result table (full width, sortable)  │                   │
│      │ Score heatmap                        │                   │
│      │ Signals (inline)                     │                   │
└──────┴─────────────────────────────────────┴───────────────────┘
```
Three columns at >1280px. Left rail with vertical icon nav, right rail with
live-data panels and a session audit feed.

#### Typography
- Body 13px, chrome 12px. Tighter line-height (1.4).
- Mono everywhere data is numeric.

#### Color
- Cooler grays, slightly more contrast (`--bg #08090d`).
- Accent unchanged.
- Score heatmap uses a 7-step accent ramp for cell background.

#### Motion
- Almost none. Tab transitions instant. Panel entry 120ms only.
- Status pulse kept (operators benefit from it).

#### Mobile behavior
- Honestly poor fit for mobile. Below 720px, nav rail collapses, audit feed
  hides, and heatmap becomes the score table from direction A.

#### Risk
- High learning curve.
- Keyboard shortcuts (⌘K, ⌘P, ⌘D) imply substantial new code beyond styling.
- ChoiceLens's actual primary user (per [`2026-05-18-choice-lens-design.md`](2026-05-18-choice-lens-design.md))
  is a consumer making one decision, not an operator running queues.
  Direction C optimizes for the wrong persona at V1.

---

## 6. Recommendation: Direction A

ChoiceLens's product spec calls for "broad input, narrow output" and consumer-
default language. Direction A keeps the operator-grade density we already
have while making the recommendation visually win — which is the actual
value proposition. It is also the lowest-risk implementation: no new
dependencies, no new routes, additive tokens.

Direction B would be the right move if marketing acquisition were the next
milestone; it isn't. Direction C optimizes for the wrong user at V1.

## 7. Acceptance Criteria

If implemented per this spec, the result must:

1. **Functional parity.** All routes, tests, and flows behave exactly as
   today. `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`
   all green.
2. **No API changes.** Diff to `src/app/api/**` is empty.
3. **No store/engine changes.** Diff to `src/lib/{comparison,store,db,genlayer}/**`
   is empty (renames in CSS class strings inside JSX are allowed).
4. **Token additive.** Existing `--bg`, `--accent`, `--positive`, `--warn`,
   `--danger`, `--shadow` survive unchanged.
5. **Hero card wins.** Top pick visually dominates the result panel: larger
   name, prominent mono score, distinct surface (`--bg-elev-3`), gradient
   border.
6. **Reduced-motion respected.** With `prefers-reduced-motion: reduce`,
   no animation runs; static end-state is shown.
7. **Responsive.** Layout works without horizontal scroll on viewports of
   360px / 720px / 1080px / 1440px.
8. **Admin page de-inlined.** No inline `style={{...}}` in
   `src/app/admin/genlayer/page.tsx` after the refresh; classes only.
9. **Status pulse only on non-terminal receipts.** Terminal states
   (`finalized`, `finalized_with_error`, `failed`, `off_chain_only`)
   are static.
10. **No prod deploy until merged to master.** Vercel prod redeploy
    happens via post-merge hook only.

## 8. Test Plan

- **Static checks:** `npm run lint`, `npm run typecheck`, `npm run build`.
- **Unit / integration:** `npm test` — all existing suites must stay green.
  Specific suites to watch:
  - `src/components/receipt/__tests__/ReceiptStatusPill.test.tsx`
  - `src/components/receipt/__tests__/WalletPathToggle.test.tsx`
  - `src/app/api/**/__tests__/route.test.ts`
- **Local browser smoke (`npm run dev`):**
  - `/` empty state → run comparison → top pick renders → score bars
    animate in → save to watchlist → build receipt → receipt pill animates
    while pending → poll completes
  - `/admin/genlayer` renders with `studionet_configured` tone
  - Resize at 360 / 720 / 1080 / 1440 — no overflow, no hidden actions
  - Toggle `prefers-reduced-motion` in devtools → animations halt
- **Prod smoke after merge:**
  - `GET /api/admin/genlayer/health` → 200, `operatorState=studionet_configured`
  - `GET /admin/genlayer` → 200, no leak of `GENLAYER_SERVICE_PRIVATE_KEY`
    or `ADMIN_API_TOKEN` in HTML
  - `GET /` → 200, hero card and score table visible

## 9. File Scope (Future Implementation)

Any implementation PR off this spec is constrained to these files:

| File | Change type |
|---|---|
| `src/app/globals.css` | Additive tokens; new classes for hero card, score-bar gradient, status pulse, header blur; refactor admin classes |
| `src/app/page.tsx` | JSX-only refinement: hero TopPick markup, score-table polish, copy-buttons in receipt section |
| `src/app/admin/genlayer/page.tsx` | Replace inline styles with classes; add status strip |
| `src/components/receipt/ReceiptCard.tsx` | Add copy-to-clipboard buttons for `id`, `payloadHash`, `transactionHash`; visual polish |
| `src/components/receipt/ReceiptStatusPill.tsx` | Add `data-pulse` attribute for non-terminal states |
| `src/app/layout.tsx` | No change |

Files explicitly out of scope:

- `src/lib/**` (no logic changes)
- `src/app/api/**` (no API changes)
- `prisma/**` (no schema changes)
- `contracts/**` (no contract changes)

## 10. Open Design Status

OpenDesign daemon is reachable at `http://127.0.0.1:7456` and the MCP server
is connected. However, the MCP surface exposes read-only tools only:
`list_projects`, `get_project`, `list_files`, `get_file`, `get_artifact`,
`search_files`, `get_active_context`. There is **no** project-create or
folder-import tool surfaced from the daemon to this MCP client.

Existing OD projects on this daemon: `lexnet-full-ui-ux-redesign` (status
`not_started`) and `canonos` (status `succeeded`, base
`E:\genlayer-cli-mcp\projects\canonos`). Neither is ChoiceLens.

To wire OD into this design loop, the user must seed a ChoiceLens project
in the OD app (UI side) using the brief in §11 below. Once seeded, this
spec can be re-anchored to its OD project id, and `get_artifact` will
return the design files when the user generates them in OD.

This blocker is **non-fatal** for design approval — the spec, plan, file
scope, and acceptance criteria above are sufficient to approve and
implement. OD is the preferred high-fidelity surface but not required.

## 11. OpenDesign Seeding Brief (for the user)

Paste this into a new OpenDesign project named `choicelens-ui-refresh`,
platform `responsive-web`, fidelity `high-fidelity`, kind `prototype`:

> ChoiceLens is a web app that helps users compare options, reduce too many
> choices to a small shortlist, understand why one option fits, and watch
> for changes. The current production app at https://choicelens-beta.vercel.app
> is functionally complete: a comparison composer, priorities sliders,
> must-haves / deal-breakers, a recommendation result with score table and
> signals, an off-chain decision receipt with optional GenLayer wallet path,
> and a `/admin/genlayer` operator health page.
>
> Refresh the visual design as a calm premium decision workspace. The
> recommendation must visually win (hero card, gradient border, large mono
> score, clear "why this fits" line). The score table must feel like a
> finished artifact, not a config dump (zebra rows, hover, gradient score
> bars). The receipt card must feel finished (animated status pill while
> pending, copy-to-clipboard buttons on hash rows). The admin page must
> read like a console (status strip with traffic-light tone, count tiles
> with tone-coloured top borders, sticky-header recent-errors table).
>
> Dark mode only. Token palette: bg `#0b0d10`, accent `#6ea8ff`, second
> accent `#a784ff` (gradient with primary), positive `#5fbf8a`, warn
> `#d4a14b`, danger `#d97766`. Body 14.5px, mono ui-monospace for hashes
> and scores. Motion vars: 120 / 240 / 400ms with cubic-bezier(.2,.7,.2,1),
> all gated by prefers-reduced-motion: no-preference. Backdrop-filter blur
> on the sticky header only.
>
> Screens to design:
> 1. `/` empty state (composer ready, no result yet)
> 2. `/` populated state (hero card with top pick, score table, signals,
>    watchlist + receipt rail)
> 3. Receipt card states: off-chain, pending (pulse), accepted, finalized,
>    finalized-with-error, failed
> 4. `/admin/genlayer` populated state (studionet_configured tone)
>
> Avoid: marketing hero, generic gradients/orbs, soft pastel landing-page
> aesthetic, full-width photography, serif type, animated backgrounds.

## 12. Decision

Direction A is the recommended path. Implementation plan in
[`docs/superpowers/plans/2026-05-21-opendesign-ui-refresh.md`](../plans/2026-05-21-opendesign-ui-refresh.md).

**Awaiting `APPROVE DESIGN` before implementation.**
