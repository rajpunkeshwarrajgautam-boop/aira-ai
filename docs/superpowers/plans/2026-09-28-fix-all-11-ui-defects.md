# AIRA AI — Fix All 11 UI & Functional Defects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 11 identified UI, performance, and functional defects in AIRA AI in one coordinated release pass, verified through automated contracts and Playwright visual evidence.

**Architecture:** 
1. **Composer Layer (`SearchBox.tsx`)**: Enforce strict mutual exclusivity across popovers (`/` slash commands, `+` context, model selector, search mode, reasoning effort) with auto-close on input change, adaptive dropdown orientation, and removal of orphan `target="_blank"` links.
2. **Performance Layer (`AiraPreloader.tsx`)**: Eliminate the artificial 1500ms blocking sleep, allowing instantaneous hydration while preserving graceful branding transitions.
3. **Navigation & Sidebar Layer (`AiraV2Frame.tsx`, `SearchLayout.tsx`)**: Unify mobile drawer widths (`w-[280px] max-w-[85vw]`), resolve viewport clipping on `<920px` screens, consolidate dual mobile drawer markup, and clarify guest navigation boundaries.
4. **Layout Polish (`ConversationMessageList.tsx`, `app/signin/page.tsx`)**: De-duplicate query title headers, eliminate empty answer card whitespace, remove the fake notification dot, and clip modal glow bleed.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Lucide Icons, Node.js Test Runner, Playwright.

**Spec Reference:** Audit report at [`artifacts/ui-audit/deep_audit_report.json`](file:///c:/Users/WORKSTATION/aira-ai-command-workspace-ui/artifacts/ui-audit/deep_audit_report.json).

## Global Constraints
- Preserve all existing CI test contracts and migration baselines.
- Do NOT touch protected PR #139.
- No external packages or breaking dependencies; rely on existing React, Tailwind, and Node test runner utilities.
- Maintain WCAG 2.1 AA accessibility (keyboard escape, aria-expanded, aria-controls, focus management).

---

### Task 1: Composer Mutual Exclusivity, Auto-Closing & Popover Polish (Defects 1, 4, 5)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/components/SearchBox.tsx`
- Test: `perplexity-clone/my-turborepo/apps/web/test/composer-popover-exclusivity.test.ts`

**Interfaces:**
- Consumes: `SearchBoxProps`, `MODEL_OPTIONS`, `QUICK_COMMANDS`
- Produces: Robust popover state management with guaranteed mutual exclusivity and collision avoidance.

- [ ] **Step 1: Write the failing contract test**

```typescript
// perplexity-clone/my-turborepo/apps/web/test/composer-popover-exclusivity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("SearchBox contract enforces popover mutual exclusivity and dismisses on typing", () => {
  const searchBoxPath = path.resolve(
    process.cwd(),
    "perplexity-clone/my-turborepo/apps/web/components/SearchBox.tsx"
  );
  const content = fs.readFileSync(searchBoxPath, "utf8");

  // 1. Must close all popovers when text changes
  assert.match(
    content,
    /setContextMenuOpen\(false\)/,
    "SearchBox must close context menu when user interacts or types"
  );

  // 2. Must not contain target="_blank" for internal integrations
  assert.doesNotMatch(
    content,
    /<Link[^>]+href="\/(?:knowledge|agents|omniroute)"[^>]+target="_blank"/,
    "Internal integrations in context menu must not open in target=_blank"
  );

  // 3. Must support adaptive popover placement or downward orientation in hero mode
  assert.ok(
    content.includes("dropdownPlacement") || content.includes("top-[calc(100%") || content.includes("bottom-[calc(100%"),
    "SearchBox must position dropdowns safely without clipping"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/composer-popover-exclusivity.test.ts`
Expected: FAIL (target="_blank" assertion fails).

- [ ] **Step 3: Implement fixes in `SearchBox.tsx`**

1. In `onChange` handler:
```typescript
onChange={(event) => {
  setCommandMenuDismissedValue(null);
  setContextMenuOpen(false);
  setModelMenuOpen(false);
  setModeMenuOpen(false);
  setReasoningMenuOpen(false);
  onChange(event.target.value);
  resize();
}}
```
2. In `SearchBox.tsx`, remove `target="_blank"` from:
```tsx
<Link href="/knowledge" className="..." onClick={() => setContextMenuOpen(false)}>
<Link href="/agents" className="..." onClick={() => setContextMenuOpen(false)}>
<Link href="/omniroute" className="..." onClick={() => setContextMenuOpen(false)}>
```
3. Update popover toggle styling for `+` button so it does not switch to a jarring solid black button:
```tsx
className={cn(
  "flex size-8 items-center justify-center rounded-[6px] transition border",
  contextMenuOpen
    ? "border-[#111111] bg-[#F4F4F5] text-[#111111]"
    : "border-transparent bg-[#F4F4F5] text-[#525252] hover:bg-[#EAEAEA] hover:text-[#111111]"
)}
```
4. Support downward dropdown placement when in hero stage to prevent occluding the hero title.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/composer-popover-exclusivity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add perplexity-clone/my-turborepo/apps/web/components/SearchBox.tsx perplexity-clone/my-turborepo/apps/web/test/composer-popover-exclusivity.test.ts
git commit -m "fix(web): enforce composer popover mutual exclusivity and safe internal links"
```

---

### Task 2: Instant Workspace Hydration & Preloader Optimization (Defect 2)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/components/AiraPreloader.tsx`
- Test: `perplexity-clone/my-turborepo/apps/web/test/preloader-instant-hydration.test.ts`

**Interfaces:**
- Consumes: Browser `sessionStorage`, `useReducedMotion`
- Produces: Instant, non-blocking splash transition.

- [ ] **Step 1: Write the failing contract test**

```typescript
// perplexity-clone/my-turborepo/apps/web/test/preloader-instant-hydration.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AiraPreloader eliminates blocking 1500ms delay and supports instant unmount", () => {
  const preloaderPath = path.resolve(
    process.cwd(),
    "perplexity-clone/my-turborepo/apps/web/components/AiraPreloader.tsx"
  );
  const content = fs.readFileSync(preloaderPath, "utf8");

  // Must not have hardcoded 1500ms delay blocking interaction
  assert.doesNotMatch(
    content,
    /duration\s*=\s*shouldReduceMotion\s*\?\s*0\s*:\s*1500/,
    "Preloader must not enforce a 1500ms blocking interaction delay"
  );

  // Must have pointer-events-none or non-blocking overlay
  assert.ok(
    content.includes("pointer-events-none") || content.includes("duration <= 300"),
    "Preloader must be non-blocking to user interaction"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/preloader-instant-hydration.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement instant preloader in `AiraPreloader.tsx`**

Modify `AiraPreloader.tsx`:
1. Initialize `visible` to `false` if `sessionStorage` already has `aira-visited`.
2. Reduce display duration to 0ms (or max 200ms with `pointer-events-none` immediately upon mount).
3. Ensure exit transition is swift (200ms) with `pointer-events-none` so clicks are never intercepted:
```tsx
<motion.div 
  className="aira-preloader-container pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--aira-canvas)]"
  initial={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.2, ease: "easeOut" }}
>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/preloader-instant-hydration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add perplexity-clone/my-turborepo/apps/web/components/AiraPreloader.tsx perplexity-clone/my-turborepo/apps/web/test/preloader-instant-hydration.test.ts
git commit -m "perf(web): remove blocking preloader delay for instantaneous workspace hydration"
```

---

### Task 3: Unified Sidebar Ergonomics & Mobile Drawer Sizing (Defects 3, 6, 7, 8)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/components/AiraV2Frame.tsx`
- Modify: `perplexity-clone/my-turborepo/apps/web/components/SearchLayout.tsx`
- Test: `perplexity-clone/my-turborepo/apps/web/test/sidebar-navigation-ergonomics.test.ts`

**Interfaces:**
- Consumes: Viewport width, `isAuthed`, `desktopSidebarOpen`, `mobileNavOpen`
- Produces: Proper drawer width (`w-[280px]`), unclipped footer with visible "Settings", and unified drawer triggering.

- [ ] **Step 1: Write the failing contract test**

```typescript
// perplexity-clone/my-turborepo/apps/web/test/sidebar-navigation-ergonomics.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AiraV2Frame satisfies modern mobile drawer width and viewport scrolling", () => {
  const framePath = path.resolve(
    process.cwd(),
    "perplexity-clone/my-turborepo/apps/web/components/AiraV2Frame.tsx"
  );
  const content = fs.readFileSync(framePath, "utf8");

  // Mobile drawer width must be at least 280px (not fixed 240px)
  assert.ok(
    content.includes("w-[280px]") || content.includes("w-[80vw]"),
    "Mobile drawer must be wide enough for modern mobile screens"
  );

  // Bottom nav container must have overflow protection
  assert.ok(
    content.includes("overflow-y-auto") && content.includes("Settings"),
    "Sidebar must ensure Settings is accessible without off-screen clipping"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/sidebar-navigation-ergonomics.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement fixes in `AiraV2Frame.tsx` & `SearchLayout.tsx`**

1. In `AiraV2Frame.tsx`:
   - Change mobile drawer from `w-[240px]` to `w-[280px] max-w-[85vw]`.
   - Update sidebar structure: wrap both `nav` and bottom items in a flex column with `min-h-0 overflow-y-auto` so the `Aira PRO` promo box and `Settings` link are never clipped on `<920px` viewports.
   - For guest navigation items (`/knowledge`, `/projects`, `/library`), ensure links include appropriate `callbackUrl` or informational labels.
2. In `SearchLayout.tsx`:
   - Coordinate mobile drawer trigger so only one drawer handles mobile navigation smoothly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/sidebar-navigation-ergonomics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add perplexity-clone/my-turborepo/apps/web/components/AiraV2Frame.tsx perplexity-clone/my-turborepo/apps/web/components/SearchLayout.tsx perplexity-clone/my-turborepo/apps/web/test/sidebar-navigation-ergonomics.test.ts
git commit -m "fix(web): standardize mobile drawer width and prevent sidebar viewport clipping"
```

---

### Task 4: De-duplicate Query Headline on Search Results Page (Defect 9)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/components/SearchLayout.tsx`
- Modify: `perplexity-clone/my-turborepo/apps/web/components/conversations/ConversationMessageList.tsx`
- Test: `perplexity-clone/my-turborepo/apps/web/test/search-results-layout-dedup.test.ts`

**Interfaces:**
- Consumes: `selectedConversationTitle`, `messages`
- Produces: Clean single-title hierarchy without repeating the query string twice in the viewport.

- [ ] **Step 1: Write the failing contract test**

```typescript
// perplexity-clone/my-turborepo/apps/web/test/search-results-layout-dedup.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("SearchLayout does not redundantly duplicate the user query in both topbar and main heading", () => {
  const searchLayoutPath = path.resolve(
    process.cwd(),
    "perplexity-clone/my-turborepo/apps/web/components/SearchLayout.tsx"
  );
  const content = fs.readFileSync(searchLayoutPath, "utf8");

  // Verify breadcrumb and thread title hierarchy does not duplicate exact strings
  assert.ok(
    content.includes("selectedConversationTitle"),
    "Must manage conversation title gracefully"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/search-results-layout-dedup.test.ts`
Expected: Verify baseline.

- [ ] **Step 3: Refine headline rendering in `SearchLayout.tsx` & `ConversationMessageList.tsx`**

1. If the thread is active, display the query cleanly as the user's initiating message in the thread.
2. In the topbar or sub-bar, render a clean breadcrumb (`Research / [Topic]`) or thread control bar instead of printing the full query a second time.
3. Remove minimum height artificial whitespace on the assistant answer wrapper so concise single-sentence answers render tightly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/search-results-layout-dedup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add perplexity-clone/my-turborepo/apps/web/components/SearchLayout.tsx perplexity-clone/my-turborepo/apps/web/components/conversations/ConversationMessageList.tsx perplexity-clone/my-turborepo/apps/web/test/search-results-layout-dedup.test.ts
git commit -m "fix(web): de-duplicate query titles and optimize answer card vertical density"
```

---

### Task 5: Topbar Notification Bell & Sign-in Glow Artifact Polish (Defects 10, 11)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/components/AiraV2Frame.tsx`
- Modify: `perplexity-clone/my-turborepo/apps/web/app/signin/page.tsx`
- Test: `perplexity-clone/my-turborepo/apps/web/test/visual-affordances-polish.test.ts`

**Interfaces:**
- Consumes: Topbar header, sign-in frame styles
- Produces: Honest notification button state (no fake unread dot) and clean modal corner clipping.

- [ ] **Step 1: Write the failing contract test**

```typescript
// perplexity-clone/my-turborepo/apps/web/test/visual-affordances-polish.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AiraV2Frame removes fake unread notification dot from disabled button", () => {
  const framePath = path.resolve(
    process.cwd(),
    "perplexity-clone/my-turborepo/apps/web/components/AiraV2Frame.tsx"
  );
  const content = fs.readFileSync(framePath, "utf8");

  // Disabled notification bell must not have a fake badge dot
  assert.doesNotMatch(
    content,
    /<button[^>]+disabled[^>]+aria-label="Notifications[^"]*"[^>]*>[\s\S]*?<span[^>]+rounded-full[^>]+bg-#111111/,
    "Disabled notification bell must not render a misleading unread badge indicator"
  );

  const signinPath = path.resolve(
    process.cwd(),
    "perplexity-clone/my-turborepo/apps/web/app/signin/page.tsx"
  );
  const signinContent = fs.readFileSync(signinPath, "utf8");
  assert.match(
    signinContent,
    /overflow-hidden/,
    "Sign-in modal section must have overflow-hidden to prevent decorative bleed"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/visual-affordances-polish.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement fixes in `AiraV2Frame.tsx` and `app/signin/page.tsx`**

1. In `AiraV2Frame.tsx`:
Remove the `<span className="absolute right-2 top-2 size-2 rounded-full border-2 border-white bg-[#111111]"></span>` from the disabled notification bell.
2. In `app/signin/page.tsx`:
Add `overflow-hidden` to the modal container:
`<section className="aira-auth-frame aira-auth-frame-visme overflow-hidden" aria-label="Aira AI authentication">`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/visual-affordances-polish.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 5**

```bash
git add perplexity-clone/my-turborepo/apps/web/components/AiraV2Frame.tsx perplexity-clone/my-turborepo/apps/web/app/signin/page.tsx perplexity-clone/my-turborepo/apps/web/test/visual-affordances-polish.test.ts
git commit -m "fix(web): remove fake notification dot and clip signin decorative glow bleed"
```

---

### Task 6: Full Regression Verification & Playwright Visual Evidence (All 11 Points)

**Files:**
- Run: Full test suite (`pnpm test`)
- Run: `python scratch/run_full_deep_audit.py`
- Verify: Inspect generated screenshots in `artifacts/ui-audit/` to guarantee all 11 defects are visually eliminated.

- [ ] **Step 1: Run comprehensive web test suite**
Run: `pnpm --filter web test`
Verify: All existing and new tests exit code 0.

- [ ] **Step 2: Run Playwright Deep Audit on local or preview server**
Run: `python scratch/run_full_deep_audit.py`
Verify:
1. No slash command / context popover collision (`10_slash_command_menu.png`).
2. Immediate desktop & mobile hydration without blocking white screen (`01_desktop_hydrated_home.png`, `mobile_390x844_home.png`).
3. Mobile drawer renders cleanly at 280px (`mobile_390x844_drawer.png`).
4. Search result title de-duplicated without awkward whitespace (`11_search_results_rendered.png`).
5. Notification bell has no misleading dot.
6. Sign-in modal has zero corner bleed.

- [ ] **Step 3: Final Commit and Documentation Update**
```bash
git add docs/superpowers/plans/2026-09-28-fix-all-11-ui-defects.md
git commit -m "docs: finalize implementation plan and verification matrix for 11 UI defects"
```
