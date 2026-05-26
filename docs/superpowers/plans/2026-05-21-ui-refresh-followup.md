# UI Refresh Follow-Up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address review findings from PR #20 (caveman-review): clean up `CopyButton` timer/error handling, improve a11y of copy feedback, normalize CSS-var typing, drop a redundant keyframe stop, fix a trailing-space className, and verify header z-index does not collide with RainbowKit modals.

**Architecture:** Targeted fixes inside the same component/file scope as PR #20. No new dependencies. No behavior change beyond bug fixes for the `CopyButton` (timer leak, silent clipboard failures, missing screen-reader announcement). Each task lands as one commit.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest + React Testing Library, ESLint, plain CSS.

---

## Branch

All work lands on a single branch: `codex/ui-refresh-followup`. Create it before Task 1.

```bash
git checkout master
git pull origin master
git checkout -b codex/ui-refresh-followup
```

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/components/receipt/ReceiptCard.tsx` | Receipt detail card; hosts internal `CopyButton` | Modify `CopyButton` (timer cleanup, error surface, live region) |
| `src/components/receipt/__tests__/ReceiptCard.test.tsx` | New test file for `CopyButton` behavior | Create |
| `src/app/globals.css` | App-wide styles; receipt-copy class | Add `.visually-hidden` class; drop redundant `barFill` `to` |
| `src/app/page.tsx` | Home page; passes `--bar-width` CSS var | Replace `["--bar-width" as string]` with typed cast |
| `src/app/admin/genlayer/page.tsx` | Admin ops page | Fix trailing-space className for `serviceKeyClass` |

No files are deleted. No public API changes.

---

## Task 1: Add `visually-hidden` utility class

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add the class to globals.css**

Append at the end of the file:

```css
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 2: Verify build still works**

Run: `npm run build`
Expected: build succeeds, all routes render.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style(ui): add .visually-hidden utility for sr-only content"
```

---

## Task 2: Test-drive `CopyButton` timer cleanup

**Files:**
- Create: `src/components/receipt/__tests__/ReceiptCard.test.tsx`

`CopyButton` is not exported from `ReceiptCard.tsx`. Test it via `ReceiptCard` itself by clicking the copy button on the receipt-id row, since that exercises the same code path.

- [ ] **Step 1: Write the failing test for unmount during copied state**

Create `src/components/receipt/__tests__/ReceiptCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ReceiptCard, type ReceiptCardData } from "../ReceiptCard";

const BASE_RECEIPT: ReceiptCardData = {
  id: "rcpt_test01",
  payloadHash: "deadbeef",
  status: "finalized",
  network: "studionet",
  contractAddress: "0xD7E2910DBbCb701992591b4285985a3Ad0e0A418",
  transactionHash: "0xabc",
  createdAt: "2026-05-21T08:00:00.000Z",
};

describe("ReceiptCard CopyButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not error if unmounted while copied state is active", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <ReceiptCard receipt={BASE_RECEIPT} pollingError={null} />,
    );
    const btn = screen.getByLabelText(/copy receipt id/i);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("rapid clicks do not stack timers", async () => {
    const { rerender: _rerender } = render(
      <ReceiptCard receipt={BASE_RECEIPT} pollingError={null} />,
    );
    const btn = screen.getByLabelText(/copy receipt id/i);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      vi.advanceTimersByTime(500);
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(screen.getByLabelText(/receipt id copied/i)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(screen.getByLabelText(/receipt id copied/i)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByLabelText(/^copy receipt id$/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/receipt/__tests__/ReceiptCard.test.tsx`
Expected: at least one of the two tests fails. The "rapid clicks" test will likely fail because the first timer fires before the second click resets it. The "unmount" test may pass spuriously today because React 19 silently swallows the warning, but the new behavior should be deterministic.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/components/receipt/__tests__/ReceiptCard.test.tsx
git commit -m "test(receipt): add failing tests for CopyButton timer cleanup"
```

---

## Task 3: Implement `CopyButton` timer cleanup + error surfacing + live region

**Files:**
- Modify: `src/components/receipt/ReceiptCard.tsx`

- [ ] **Step 1: Replace `CopyButton` and its imports**

In `src/components/receipt/ReceiptCard.tsx`, replace the existing imports and `CopyButton` component with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, RotateCw } from "lucide-react";
import type { ReceiptStatus } from "@/lib/genlayer";
import { ReceiptStatusPill } from "./ReceiptStatusPill";
```

Then replace the `CopyButton` body with:

```tsx
interface CopyButtonProps {
  value: string;
  label: string;
}

function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  async function handleCopy() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setFailed(true);
      timeoutRef.current = setTimeout(() => {
        setFailed(false);
        timeoutRef.current = null;
      }, 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, 1500);
    } catch (err) {
      console.error(`copy ${label} failed`, err);
      setFailed(true);
      timeoutRef.current = setTimeout(() => {
        setFailed(false);
        timeoutRef.current = null;
      }, 1500);
    }
  }

  const ariaLabel = copied
    ? `${label} copied`
    : failed
    ? `Could not copy ${label}`
    : `Copy ${label}`;

  return (
    <>
      <button
        type="button"
        className="receipt-copy"
        onClick={handleCopy}
        data-copied={copied ? "true" : undefined}
        data-failed={failed ? "true" : undefined}
        aria-label={ariaLabel}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <span role="status" aria-live="polite" className="visually-hidden">
        {copied ? `${label} copied` : failed ? `Could not copy ${label}` : ""}
      </span>
    </>
  );
}
```

- [ ] **Step 2: Run the new tests — they must pass**

Run: `npx vitest run src/components/receipt/__tests__/ReceiptCard.test.tsx`
Expected: both tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: 84/84 tests pass (82 existing + 2 new).

- [ ] **Step 4: Commit**

```bash
git add src/components/receipt/ReceiptCard.tsx
git commit -m "fix(receipt): clear CopyButton timer on unmount + rapid re-click; surface clipboard errors; add live region"
```

---

## Task 4: Style the failed copy state

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add the failed-state rule**

Find the existing `.receipt-copy[data-copied="true"]` rule and append below it:

```css
.receipt-copy[data-failed="true"] {
  color: var(--danger);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style(receipt): tone failed copy-button state with danger color"
```

---

## Task 5: Fix CSS-var typing in score-bar

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace the awkward cast**

In `src/app/page.tsx`, find the score-bar JSX and replace:

```tsx
<span
  className="score-bar-fill"
  style={{ ["--bar-width" as string]: `${score}%` }}
/>
```

with:

```tsx
<span
  className="score-bar-fill"
  style={{ "--bar-width": `${score}%` } as React.CSSProperties}
/>
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor(ui): cleaner CSS-var cast in ScoreTable score-bar"
```

---

## Task 6: Drop redundant `to` in `barFill` keyframe

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Remove the `to` rule**

In `src/app/globals.css`, find:

```css
@keyframes barFill {
  from { width: 0%; }
  to { width: var(--bar-width, 0%); }
}
```

Replace with:

```css
@keyframes barFill {
  from { width: 0%; }
}
```

The static `width: var(--bar-width, 0%)` rule on `.score-bar-fill` defines the end state. With `animation-fill-mode` defaulting to `none`, the keyframe runs from 0% and the final width comes from the base rule.

- [ ] **Step 2: Verify build + visual smoke**

Run: `npm run build && npm run dev`
Then in another terminal: `curl -sS http://localhost:3000/ -o /dev/null -w "%{http_code}\n"` → expect 200.
Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "refactor(ui): drop redundant to-stop in barFill keyframe"
```

---

## Task 7: Fix trailing-space className in admin page

**Files:**
- Modify: `src/app/admin/genlayer/page.tsx`

- [ ] **Step 1: Replace the className join**

In `src/app/admin/genlayer/page.tsx`, find the count-tile loop and replace:

```tsx
const tone = COUNT_TONE[label] ?? "neutral";
const toneClass = tone === "neutral" ? "" : `tone-${tone}`;
return (
  <div
    key={label}
    className={`admin-count-tile ${toneClass}`.trim()}
  >
```

with:

```tsx
const tone = COUNT_TONE[label] ?? "neutral";
const classes = ["admin-count-tile"];
if (tone !== "neutral") classes.push(`tone-${tone}`);
return (
  <div
    key={label}
    className={classes.join(" ")}
  >
```

- [ ] **Step 2: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/genlayer/page.tsx
git commit -m "refactor(admin): clean class-name join for count-tile tone"
```

---

## Task 8: Verify header z-index vs RainbowKit modal (no code change unless reproduced)

**Files:**
- None to modify unless reproduced.

- [ ] **Step 1: Check whether RainbowKit modal renders via portal**

Run: `npx grep -rE "ConnectModal|createPortal|z-index" node_modules/@rainbow-me/rainbowkit/dist 2>/dev/null | head -10`

Expected: at least one hit referencing portal or z-index. RainbowKit v2 mounts the connect modal via a React portal at the document body; this is fine as long as our header `z-index: 10` is below the modal's. RainbowKit's modal uses z-index in the thousands by default.

- [ ] **Step 2: Document the finding inline**

If portal usage is confirmed (expected): no code change. Add the following comment above `.app-header` rule in `src/app/globals.css`:

```css
/* z-index: 10 keeps header above panels but below RainbowKit's modal portal (z-index >= 1000). */
.app-header {
  ...
}
```

- [ ] **Step 3: If portal NOT confirmed, raise z-index of modal wrapper instead of lowering header**

This is a hypothetical fallback. Skip if Step 1 confirmed portal.

- [ ] **Step 4: Commit (if a comment was added)**

```bash
git add src/app/globals.css
git commit -m "docs(ui): document app-header z-index relationship to RainbowKit modal"
```

---

## Task 9: Final gates and PR

**Files:** none

- [ ] **Step 1: Run all gates locally**

Run sequentially (chain so a failure stops the run):

```bash
npm run lint && npm run typecheck && npm run build && npm test
```

Expected: lint clean, typecheck clean, build succeeds, all tests pass (84/84 expected: 82 existing + 2 added in Task 2).

- [ ] **Step 2: Push branch**

```bash
git push -u origin codex/ui-refresh-followup
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "fix(ui): review follow-ups for UI refresh" --body "$(cat <<'EOF'
## Summary
Addresses review findings from PR #20.

- CopyButton: `setTimeout` cleared on unmount and rapid re-click; clipboard errors logged + surfaced via danger-toned button + sr-only live region announcement.
- A11y: new `.visually-hidden` utility; copy outcome announced via `role=status aria-live=polite`.
- ScoreTable: cleaner `React.CSSProperties` cast for `--bar-width`.
- `barFill` keyframe: dropped redundant `to` stop; static rule provides end state.
- Admin count-tile: array-join className, no trailing space.
- Header z-index: documented relationship to RainbowKit modal portal.

## Tests
- New: `src/components/receipt/__tests__/ReceiptCard.test.tsx` — covers unmount-during-copied and rapid-click-no-stack timer behavior.
- Existing: 82/82 still pass.

## Test plan
- [x] lint, typecheck, build, test all green
- [ ] Vercel preview deploys cleanly
- [ ] Prod smoke after merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI; merge if green**

```bash
gh pr checks <pr-number>
gh pr merge <pr-number> --squash --delete-branch
```

If a non-blocking review is the only gate, `--admin` is permitted per existing user instruction.

- [ ] **Step 5: Sync master + smoke prod**

```bash
git checkout master
git pull origin master
```

Then:

```bash
set -a; . ./.env; set +a
BASE=https://choicelens-beta.vercel.app
curl -sS -H "Authorization: Bearer $ADMIN_API_TOKEN" "$BASE/api/admin/genlayer/health" | jq '{operatorState, lastSuccessfulAt}'
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/admin/genlayer"
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/"
```

Expected: `operatorState=studionet_configured`, both pages return 200. No secret values are printed.

---

## Acceptance Criteria

1. `CopyButton` no longer leaks timers on unmount or rapid re-click (verified by Task 2 tests).
2. Clipboard failures (denied permission, non-secure context) flip the button to a `data-failed` state and announce via the live region.
3. Screen readers announce "<label> copied" via `role=status aria-live=polite`.
4. `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` all green.
5. Visual parity with PR #20 outside the new failed state.
6. No new dependencies. No API changes. No store/engine changes.

## Out of Scope

- Restyling the receipt card.
- Touching wallet flow, polling, or admin data shape.
- Adding Storybook or Playwright.
- Changing other tone classnames in admin page (only `count-tile` had the trailing-space issue).
