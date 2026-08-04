# Android More Redesign + Mobile Sizing Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile "More" bottom sheet (which renders the desktop sidebar verbatim) with a full-screen, search-first `/more` route, then measure and fix touch-target/layout sizing across every mobile screen.

**Architecture:** Nav data and nav rendering are currently fused in `Sidebar.tsx`. Task 1 extracts the data plus a pure filter function into `navItems.ts`. Task 2 builds a new `/more` screen on top of it. Task 3 rewires the mobile nav and deletes the sheet. Tasks 5–6 add a Playwright harness that measures every route at Android's viewport and drives a fix loop until it reports zero findings.

**Tech Stack:** React 19 + react-router, TypeScript, Tailwind (CSS custom properties for theming), Zustand, Vitest, Playwright, Tauri v2 (Android).

## Global Constraints

- Target viewport: **448×997 CSS px** (Pixel 9 Pro XL, 1344×2992 @ density 480).
- Every interactive element must be **≥44×44 px** on touch (`docs/v5-mobile-design.md` §4.1). More screen rows use **56px**.
- **No fixed `w-*` / rem widths on mobile containers** — the app supports font-size zoom (§6.4), so rem widths grow while the viewport does not.
- **Exactly one scroll container.** `AppShell.tsx:967` already makes `<main>` the scroller (`overflow-y-auto` + `pb-[calc(56px+env(safe-area-inset-bottom))]`). Screens must NOT add `overflow-y-auto`. Use `position: sticky` instead.
- All user-visible strings go through `tr("key", undefined, "English fallback")`. New keys must be added to `client/src/i18n/locales/en.ts` AND allowlisted in `scripts/i18n-known-missing.json`, or `make quality` fails.
- Desktop `TabRail` drawer (md+) is **out of scope** — do not modify its behaviour.
- Run from repo root: `/Users/yunpengl/workspace/github.com/phantomptr/ps5upload`.

---

## File Structure

| File | Responsibility |
|---|---|
| `client/src/layout/navItems.ts` | **Create.** `NavItem` type, `NAV_ITEMS` array, `groupNavItems()`, pure `filterNavItems()`. No React. |
| `client/src/layout/navItems.test.ts` | **Create.** Unit tests for the two pure functions. |
| `client/src/screens/More/index.tsx` | **Create.** The `/more` screen. |
| `client/src/layout/Sidebar.tsx` | **Modify.** Import from `navItems.ts`; delete the inline `items` array and `NavItem` interface. Desktop rendering only. |
| `client/src/layout/TabNav.tsx` | **Modify.** Mobile More button → `NavLink to="/more"`; delete the mobile sheet JSX and its `moreOpen` state/effect. |
| `client/src/App.tsx` | **Modify.** Register lazy `/more` route. |
| `client/src/i18n/locales/en.ts` | **Modify.** New `more_*` keys. |
| `scripts/i18n-known-missing.json` | **Modify.** Allowlist new keys for 18 locales. |
| `scripts/mobile-audit.mjs` | **Create.** Playwright measurement harness. |
| `scripts/mobile-audit-allowlist.json` | **Create.** Accepted exceptions. |
| `client/package.json` | **Modify.** Add `audit:mobile` script. |

---

### Task 1: Extract nav data into a pure module

Sidebar.tsx is 512 lines mixing a ~190-line data array with rendering, collapse state, and a theme toggle. Mobile can't reuse the data without the desktop chrome. This task is a pure refactor: behaviour must not change.

**Files:**
- Create: `client/src/layout/navItems.ts`
- Create: `client/src/layout/navItems.test.ts`
- Modify: `client/src/layout/Sidebar.tsx` (delete lines 85-99 `NavItem` interface and 101-295 `items` array; import instead)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface NavItem { to: string; key: string; fallback: string; icon: LucideIcon; section?: { key: string; fallback: string }; hideInBrowser?: boolean }`
  - `const NAV_ITEMS: NavItem[]`
  - `type NavGroup = { section: NonNullable<NavItem["section"]>; items: NavItem[] }`
  - `function groupNavItems(items: NavItem[]): NavGroup[]`
  - `function filterNavItems(items: NavItem[], query: string, tr: TrFn): NavItem[]`
  - `type TrFn = (key: string, vars?: Record<string, string | number>, fallback?: string) => string`

- [ ] **Step 1: Write the failing test**

Create `client/src/layout/navItems.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, groupNavItems, filterNavItems } from "./navItems";

// Minimal `tr` stub: returns the fallback, like an untranslated locale.
const tr = (_k: string, _v?: Record<string, string | number>, fb?: string) =>
  fb ?? _k;

describe("NAV_ITEMS", () => {
  it("every item has a unique route", () => {
    const routes = NAV_ITEMS.map((i) => i.to);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("starts with a sectioned item so no item is orphaned", () => {
    expect(NAV_ITEMS[0].section).toBeDefined();
  });
});

describe("groupNavItems", () => {
  it("groups items under the preceding section header", () => {
    const groups = groupNavItems([
      { to: "/a", key: "a", fallback: "A", icon: null as never,
        section: { key: "s1", fallback: "S1" } },
      { to: "/b", key: "b", fallback: "B", icon: null as never },
      { to: "/c", key: "c", fallback: "C", icon: null as never,
        section: { key: "s2", fallback: "S2" } },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].section.key).toBe("s1");
    expect(groups[0].items.map((i) => i.to)).toEqual(["/a", "/b"]);
    expect(groups[1].items.map((i) => i.to)).toEqual(["/c"]);
  });

  it("returns an empty array for no items", () => {
    expect(groupNavItems([])).toEqual([]);
  });
});

describe("filterNavItems", () => {
  const items: NavItem[] = [
    { to: "/console", key: "hardware", fallback: "Hardware", icon: null as never,
      section: { key: "s", fallback: "S" } },
    { to: "/saves", key: "saves", fallback: "Save data", icon: null as never },
  ];

  it("returns everything for an empty query", () => {
    expect(filterNavItems(items, "", tr)).toHaveLength(2);
    expect(filterNavItems(items, "   ", tr)).toHaveLength(2);
  });

  it("matches case-insensitively", () => {
    expect(filterNavItems(items, "HARD", tr).map((i) => i.to)).toEqual([
      "/console",
    ]);
  });

  it("matches the English fallback even when translated", () => {
    // A locale where Hardware translates to something unrelated.
    const jaTr = (k: string) => (k === "hardware" ? "ハードウェア" : k);
    expect(filterNavItems(items, "hardware", jaTr).map((i) => i.to)).toEqual([
      "/console",
    ]);
  });

  it("matches the translated label", () => {
    const jaTr = (k: string) => (k === "hardware" ? "ハードウェア" : k);
    expect(filterNavItems(items, "ハード", jaTr).map((i) => i.to)).toEqual([
      "/console",
    ]);
  });

  it("ignores diacritics", () => {
    const frTr = (k: string) => (k === "saves" ? "Sauvegardés" : k);
    expect(filterNavItems(items, "sauvegardes", frTr).map((i) => i.to)).toEqual([
      "/saves",
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterNavItems(items, "zzzz", tr)).toEqual([]);
  });
});
```

Add `import type { NavItem } from "./navItems";` at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/layout/navItems.test.ts`
Expected: FAIL — `Failed to resolve import "./navItems"`.

- [ ] **Step 3: Create `navItems.ts`**

Create `client/src/layout/navItems.ts`. Move the icon imports, the `NavItem` interface (currently `Sidebar.tsx:85-99`) and the `items` array (currently `Sidebar.tsx:101-295`) verbatim, renaming `items` to `NAV_ITEMS`. Then append:

```ts
export type NavGroup = {
  section: NonNullable<NavItem["section"]>;
  items: NavItem[];
};

export type TrFn = (
  key: string,
  vars?: Record<string, string | number>,
  fallback?: string,
) => string;

/**
 * Collapse a flat item list into sections. An item carrying a `section`
 * opens a new group; every item after it joins that group until the next
 * sectioned item. Items before the first section header are dropped —
 * `NAV_ITEMS[0]` always carries one (asserted by a unit test).
 */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  const acc: NavGroup[] = [];
  for (const item of items) {
    if (item.section) {
      acc.push({ section: item.section, items: [item] });
    } else {
      acc[acc.length - 1]?.items.push(item);
    }
  }
  return acc;
}

/** Strip diacritics and case so "sauvegardes" matches "Sauvegardés". */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase();
}

/**
 * Filter nav items by a free-text query.
 *
 * Matches BOTH the translated label and the English fallback, so a user
 * on a Japanese locale can still type "hardware" and find it — English
 * screen names are what most of the community documentation uses.
 * An empty or whitespace-only query returns everything.
 */
export function filterNavItems(
  items: NavItem[],
  query: string,
  tr: TrFn,
): NavItem[] {
  const q = norm(query.trim());
  if (!q) return items;
  return items.filter((item) => {
    const translated = norm(tr(item.key, undefined, item.fallback));
    const english = norm(item.fallback);
    return translated.includes(q) || english.includes(q);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/layout/navItems.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Rewire Sidebar.tsx to the shared module**

In `client/src/layout/Sidebar.tsx`:
1. Delete the `NavItem` interface and the `items` array.
2. Delete every now-unused lucide icon import (keep only `ChevronDown` and the theme icons `Sun`, `Moon`, `MoonStar`, `Flower2`, plus `Cable` if still referenced by a type default — check with the linter).
3. Add: `import { NAV_ITEMS, groupNavItems, type NavItem } from "./navItems";`
4. Replace the `groups` memo body:

```ts
  const groups = useMemo(
    () =>
      groupNavItems(
        NAV_ITEMS.filter((item) => !item.hideInBrowser || isTauriEnv()),
      ),
    [],
  );
```

- [ ] **Step 6: Verify nothing regressed**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx eslint src/layout/ && npx vitest run`
Expected: no type errors, no lint errors (in particular no unused-import errors in Sidebar.tsx), all tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/layout/navItems.ts client/src/layout/navItems.test.ts client/src/layout/Sidebar.tsx
git commit -m "refactor(nav): extract nav items + pure filter into navItems.ts"
```

---

### Task 2: Build the `/more` screen

**Files:**
- Create: `client/src/screens/More/index.tsx`
- Modify: `client/src/App.tsx` (add lazy import near line 31; add route near line 122)
- Modify: `client/src/i18n/locales/en.ts`
- Modify: `scripts/i18n-known-missing.json`

**Interfaces:**
- Consumes: `NAV_ITEMS`, `groupNavItems`, `filterNavItems`, `NavItem` from Task 1.
- Produces: default-exported `MoreScreen` React component; route `/more`.

- [ ] **Step 1: Create the screen**

Create `client/src/screens/More/index.tsx`:

```tsx
/**
 * More (v5 §3.3, mobile).
 *
 * The mobile "everything else" hub. Replaces the old bottom sheet that
 * rendered the desktop <Sidebar> verbatim — a fixed 270px-wide,
 * 1858px-tall column stuffed into a height-capped sheet with 36px rows
 * and two nested scroll containers.
 *
 * Three zones: console switcher + search (sticky), the screen list
 * (grouped, or flat while searching), and a utility footer.
 *
 * SCROLLING: this screen deliberately has NO scroll container of its
 * own. <main> in AppShell is already `overflow-y-auto` with the
 * bottom-nav padding applied; adding another would recreate the exact
 * nested-scroll bug this screen exists to fix. The sticky header works
 * inside main's scroll context.
 */
import { useMemo, useState } from "react";
import { NavLink } from "react-router";
import { ChevronRight, LayoutGrid, Search, X } from "lucide-react";

import { PageHeader, Input, EmptyState } from "../../components";
import { useTr } from "../../state/lang";
import { useLogsStore } from "../../state/logs";
import { useUpdateStore } from "../../state/update";
import { useThemeStore } from "../../state/theme";
import { isTauriEnv } from "../../lib/tauriEnv";
import { getAppVersion } from "../../lib/appVersion";
import { useEffect } from "react";
import RosterPicker from "../../layout/RosterPicker";
import NotificationInbox from "../../layout/NotificationInbox";
import {
  NAV_ITEMS,
  groupNavItems,
  filterNavItems,
  type NavItem,
} from "../../layout/navItems";

export default function MoreScreen() {
  const tr = useTr();
  const [query, setQuery] = useState("");
  const { theme, toggleTheme } = useThemeStore();
  const [version, setVersion] = useState("");
  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  const errorCount = useLogsStore(
    (s) => s.entries.filter((e) => e.level === "error").length,
  );
  const updateAvailable = useUpdateStore((s) => s.phase.kind === "available");

  const visible = useMemo(
    () => NAV_ITEMS.filter((i) => !i.hideInBrowser || isTauriEnv()),
    [],
  );
  const matches = useMemo(
    () => filterNavItems(visible, query, tr),
    [visible, query, tr],
  );
  const groups = useMemo(() => groupNavItems(matches), [matches]);
  const searching = query.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <PageHeader
        icon={LayoutGrid}
        title={tr("more_title", undefined, "More")}
        description={tr(
          "more_description",
          undefined,
          "Every screen, plus your consoles and app settings.",
        )}
      />

      {/* Sticky zone: console switcher + search. Sticks inside <main>'s
          scroll context — this screen adds no scroller of its own. */}
      <div className="sticky top-0 z-10 -mx-4 bg-[var(--color-bg)] px-4 pb-3 pt-1">
        <RosterPicker />
        <div className="mt-3">
          <Input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={tr("more_search_placeholder", undefined, "Search screens")}
            placeholder={tr(
              "more_search_placeholder",
              undefined,
              "Search screens",
            )}
            leftIcon={<Search size={18} />}
            className="h-12"
            rightSlot={
              query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={tr("more_search_clear", undefined, "Clear search")}
                  className="flex h-11 w-11 items-center justify-center rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)]"
                >
                  <X size={18} />
                </button>
              ) : undefined
            }
          />
        </div>
      </div>

      {matches.length === 0 ? (
        <EmptyState
          icon={Search}
          title={tr("more_no_results", undefined, "No screens match")}
          message={tr(
            "more_no_results_desc",
            undefined,
            "Try a different word — screen names also match their English titles.",
          )}
        />
      ) : searching ? (
        /* Flat results — grouping is noise once the list is narrowed. */
        <ul className="mt-1">
          {matches.map((item) => (
            <MoreRow
              key={item.to}
              item={item}
              errorCount={errorCount}
              updateAvailable={updateAvailable}
            />
          ))}
        </ul>
      ) : (
        groups.map((group) => (
          <section key={group.section.key} className="mt-4 first:mt-1">
            <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              {tr(group.section.key, undefined, group.section.fallback)}
            </h2>
            <ul>
              {group.items.map((item) => (
                <MoreRow
                  key={item.to}
                  item={item}
                  errorCount={errorCount}
                  updateAvailable={updateAvailable}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Utility footer — theme, notifications, version. */}
      <div className="mt-6 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-11 items-center gap-2 rounded-md px-3 text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
          aria-label={tr(
            "switch_theme",
            { current: theme },
            `Switch theme (current: ${theme})`,
          )}
        >
          {tr("more_theme", undefined, "Theme")}
        </button>
        <div className="flex items-center gap-2">
          <NotificationInbox />
          <span className="text-xs tabular-nums text-[var(--color-muted)]">
            {version ? `v${version}` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * One 56px navigation row. Full-bleed tappable, chevron affordance,
 * and the same Logs error / Settings update badges the sidebar shows.
 */
function MoreRow({
  item,
  errorCount,
  updateAvailable,
}: {
  item: NavItem;
  errorCount: number;
  updateAvailable: boolean;
}) {
  const tr = useTr();
  const Icon = item.icon;
  const showErrors = item.to === "/logs" && errorCount > 0;
  const showUpdate = item.to === "/settings" && updateAvailable;
  return (
    <li>
      <NavLink
        to={item.to}
        className={({ isActive }) =>
          [
            "flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
            isActive
              ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-contrast)]"
              : "text-[var(--color-text)] active:bg-[var(--color-surface-3)]",
          ].join(" ")
        }
      >
        <Icon size={22} strokeWidth={1.75} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {tr(item.key, undefined, item.fallback)}
        </span>
        {showErrors && (
          <span className="rounded-full bg-[var(--color-bad)] px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
            {errorCount > 99 ? "99+" : errorCount}
          </span>
        )}
        {showUpdate && (
          <span
            className="h-2 w-2 rounded-full bg-[var(--color-accent)]"
            aria-label={tr("update_available_short", undefined, "Update available")}
          />
        )}
        <ChevronRight size={18} className="shrink-0 text-[var(--color-muted)]" />
      </NavLink>
    </li>
  );
}
```

- [ ] **Step 2: Register the route**

In `client/src/App.tsx`, add next to the other lazy imports (~line 31):

```ts
const MoreScreen = lazy(() => import("./screens/More"));
```

and add the route alongside the others:

```tsx
        <Route
          path="/more"
          element={
            <Suspense fallback={<ScreenLoader />}>
              <MoreScreen />
            </Suspense>
          }
        />
```

- [ ] **Step 3: Add the i18n keys**

In `client/src/i18n/locales/en.ts`, next to the other `v5_tab_*` keys:

```ts
  more_title: "More",
  more_description: "Every screen, plus your consoles and app settings.",
  more_search_placeholder: "Search screens",
  more_search_clear: "Clear search",
  more_no_results: "No screens match",
  more_no_results_desc:
    "Try a different word — screen names also match their English titles.",
  more_theme: "Theme",
```

- [ ] **Step 4: Allowlist the keys for the other 18 locales**

Run from repo root:

```bash
python3 - <<'PY'
import json, collections
NEW = ["more_title","more_description","more_search_placeholder",
       "more_search_clear","more_no_results","more_no_results_desc","more_theme"]
p = "scripts/i18n-known-missing.json"
with open(p) as f:
    d = json.load(f, object_pairs_hook=collections.OrderedDict)
for loc, v in d.items():
    if not isinstance(v, dict) or "missing" not in v:
        continue
    miss = list(v["missing"])
    for k in NEW:
        if k not in miss:
            miss.append(k)
    v["missing"] = sorted(miss)
with open(p, "w") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("ok")
PY
```

- [ ] **Step 5: Verify**

Run: `node scripts/i18n-coverage.mjs && cd client && npx tsc --noEmit -p tsconfig.json && npx eslint src/screens/More/`
Expected: `[i18n-coverage] ok (19 languages)`, no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/screens/More client/src/App.tsx client/src/i18n/locales/en.ts scripts/i18n-known-missing.json
git commit -m "feat(mobile): full-screen search-first More screen"
```

---

### Task 3: Rewire mobile nav, delete the sheet

**Files:**
- Modify: `client/src/layout/TabNav.tsx` (`TabBottomNav`, lines ~298-408)

**Interfaces:**
- Consumes: the `/more` route from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Replace the More button and delete the sheet**

In `TabBottomNav`:

1. Delete `const [moreOpen, setMoreOpen] = useState(false);`, `moreRef`, `moreBtnRef`, and the entire `useEffect` that locks body scroll and binds Escape (lines ~301-323).
2. Replace the More `<button>` (lines ~357-367) with:

```tsx
        {/* More — a real route, so the Android hardware back button and
            the backStack treat it like any other screen (§3.4). */}
        <NavLink
          to="/more"
          aria-label={tr("v5_tab_more", undefined, "More")}
          className={({ isActive }) =>
            [
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
              isActive ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]",
            ].join(" ")
          }
        >
          <MoreHorizontal size={22} aria-hidden />
          <span>{tr("v5_tab_more", undefined, "More")}</span>
        </NavLink>
```

3. Delete the entire mobile sheet block (`{moreOpen && ( ... )}`, lines ~371-405).
4. Remove the now-unused `X` import if `TabRail` no longer needs it (it does — keep it).
5. Remove `Sidebar` from the import list only if `TabRail` no longer uses it (it does — keep it).

- [ ] **Step 2: Fix the latent `tr()` argument bug**

`TabNav.tsx` calls `tr("v5_tab_more", "More")` and `tr(\`v5_tab_${tab.id}\`, tab.id)` — passing the fallback as the **`vars`** parameter. The signature is `tr(key, vars?, fallback?)`, so these have no fallback at all: a missing key renders the raw key string. The keys exist today, so nothing is visibly broken, but it is wrong and will bite on the next key rename.

Fix every occurrence in this file to the three-argument form, e.g.:

```tsx
const label = tr(`v5_tab_${tab.id}`, undefined, tab.id);
const desc = tr(`v5_tab_${tab.id}_desc`, undefined, "");
```
```tsx
aria-label={tr("nav_close_aria", undefined, "Close")}
```
```tsx
aria-label={tr("v5_tab_primary_nav", undefined, "Primary")}
```

- [ ] **Step 3: Verify**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx eslint src/layout/TabNav.tsx && npx vitest run`
Expected: clean. In particular no unused-variable errors for the deleted state.

- [ ] **Step 4: Manually confirm in the browser**

```bash
cd client && npm run dev:vite -- --host 0.0.0.0
```
Open `http://localhost:1420/` in a 448×997 viewport. Tap More in the bottom nav. Expect: navigation to `/more`, the More tab highlighted, one scrollbar, full-width rows, no sheet.

- [ ] **Step 5: Commit**

```bash
git add client/src/layout/TabNav.tsx
git commit -m "feat(mobile): More tab navigates to /more; delete the sidebar sheet"
```

---

### Task 4: Verify the More screen meets the sizing contract

**Files:** none modified — this task is a measurement gate before building the general harness.

- [ ] **Step 1: Measure the new screen**

With the dev server running, in a browser console at 448×997 on `/more`:

```js
const els = [...document.querySelectorAll('main a, main button, main input')]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
const small = els.filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; });
const scrollers = [...document.querySelectorAll('main *')]
  .filter(e => ['auto','scroll'].includes(getComputedStyle(e).overflowY));
console.log({ total: els.length, under44: small.length,
  offenders: small.map(e => e.tagName + ':' + (e.textContent||'').trim().slice(0,20)),
  scrollersInsideMain: scrollers.length,
  bodyHOverflow: document.body.scrollWidth > document.body.clientWidth });
```

Expected: `under44: 0`, `scrollersInsideMain: 0`, `bodyHOverflow: false`.

- [ ] **Step 2: Fix anything that fails, then re-run Step 1**

Most likely offender is a `RosterPicker` or `NotificationInbox` control that predates the 44px rule. Fix by raising the control's own min height in its component — do not special-case it on the More screen, since the same control appears elsewhere.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A client/src
git commit -m "fix(mobile): raise sub-44px controls on the More screen"
```

---

### Task 5: Build the mobile audit harness

**Files:**
- Create: `scripts/mobile-audit.mjs`
- Create: `scripts/mobile-audit-allowlist.json`
- Modify: `client/package.json` (add `audit:mobile` script)

**Interfaces:**
- Consumes: a running dev server at `http://localhost:1420`.
- Produces: CLI `node scripts/mobile-audit.mjs [--json]`; exit 0 = clean, 1 = findings.

- [ ] **Step 1: Create the allowlist seed**

Create `scripts/mobile-audit-allowlist.json`:

```json
{
  "_comment": "Accepted sub-44px / layout exceptions, keyed by route. Mirrors scripts/i18n-known-missing.json. Each entry needs a reason.",
  "routes": {}
}
```

- [ ] **Step 2: Create the harness**

Create `scripts/mobile-audit.mjs`:

```js
#!/usr/bin/env node
/*
 * Mobile sizing audit.
 *
 * Walks every app route at Android's viewport and reports interactive
 * elements below the 44px touch-target floor (docs/v5-mobile-design.md
 * §4.1), nested scroll containers, and horizontal overflow.
 *
 * Requires a dev server: `cd client && npm run dev:vite`.
 * Exit 0 = clean, 1 = findings.
 *
 * LIMITATION: this measures the BROWSER build at Android's viewport. It
 * covers layout, sizing and overflow — not WebView-specific rendering,
 * real touch behaviour, or device-reported safe-area insets. Confirm on
 * hardware with `adb exec-out screencap`.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.AUDIT_BASE || "http://localhost:1420";
const VIEWPORT = { width: 448, height: 997 };
const MIN_TARGET = 44;
const JSON_OUT = process.argv.includes("--json");

const ROUTES = [
  "/home", "/connection", "/whats-new", "/dashboard", "/more",
  "/upload", "/install-package", "/saves", "/screenshots", "/videos",
  "/games", "/installed", "/files", "/search", "/volumes", "/disk-usage",
  "/console", "/processes", "/profile", "/fan-curve", "/remote-play",
  "/notifications", "/cheats", "/game-activity", "/sdk-changer", "/tmdb",
  "/fw-spoof", "/ftp-server", "/smb-browser", "/backup", "/nanodns",
  "/shell", "/tasks", "/stats", "/logs", "/audit-log", "/bug-report",
  "/faq", "/settings", "/about", "/payloads",
];

const allow = JSON.parse(readFileSync("scripts/mobile-audit-allowlist.json", "utf8"));

/** Runs in the page. Returns findings for the current route. */
function probe(minTarget) {
  const sel = 'a, button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  };
  const label = (el) =>
    (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "")
      .trim().replace(/\s+/g, " ").slice(0, 40);
  const path = (el) => {
    // Short, stable-ish selector for the allowlist.
    const cls = (el.getAttribute("class") || "").split(/\s+/).slice(0, 2).join(".");
    return el.tagName.toLowerCase() + (cls ? "." + cls : "");
  };

  const root = document.querySelector("main") || document.body;
  const els = [...root.querySelectorAll(sel)].filter(visible);

  const small = els
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), label: label(el), sel: path(el) };
    })
    .filter((e) => e.h < minTarget || e.w < minTarget);

  const scrollable = (el) => {
    const s = getComputedStyle(el);
    return ["auto", "scroll"].includes(s.overflowY) && el.scrollHeight > el.clientHeight;
  };
  const scrollers = [...root.querySelectorAll("*")].filter(scrollable);
  const nested = scrollers
    .filter((el) => scrollers.some((o) => o !== el && o.contains(el)))
    .map(path);

  return {
    smallTargets: small,
    nestedScrollers: [...new Set(nested)],
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const report = [];

for (const route of ROUTES) {
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 20000 });
  } catch {
    report.push({ route, error: "navigation failed" });
    continue;
  }
  // Let lazy chunks and first paint settle.
  await page.waitForTimeout(400);
  const res = await page.evaluate(probe, MIN_TARGET);
  const allowed = new Set(allow.routes[route] || []);
  const small = res.smallTargets.filter((s) => !allowed.has(s.sel));
  if (small.length || res.nestedScrollers.length || res.hOverflow) {
    report.push({ route, ...res, smallTargets: small });
  }
}

await browser.close();

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else if (report.length === 0) {
  console.log(`[mobile-audit] ok — ${ROUTES.length} routes clean at ${VIEWPORT.width}x${VIEWPORT.height}`);
} else {
  console.log(`[mobile-audit] ${report.length} route(s) with findings:\n`);
  for (const r of report) {
    console.log(`  ${r.route}`);
    if (r.error) { console.log(`      ! ${r.error}`); continue; }
    if (r.hOverflow) console.log("      ! horizontal overflow");
    for (const n of r.nestedScrollers) console.log(`      ! nested scroller: ${n}`);
    for (const s of r.smallTargets)
      console.log(`      ! ${s.w}x${s.h}px  "${s.label}"  (${s.sel})`);
  }
  console.log(`\n  fix the above, or allowlist in scripts/mobile-audit-allowlist.json with a reason`);
}

process.exit(report.length === 0 ? 0 : 1);
```

- [ ] **Step 3: Add the npm script**

In `client/package.json` `"scripts"`, add:

```json
    "audit:mobile": "node ../scripts/mobile-audit.mjs"
```

- [ ] **Step 4: Run it**

```bash
cd client && npm run dev:vite -- --host 0.0.0.0 &
# wait for "ready in"
node scripts/mobile-audit.mjs
```

Expected: a list of findings (this is the first run — findings are the point). Record the count.

- [ ] **Step 5: Commit the harness**

```bash
git add scripts/mobile-audit.mjs scripts/mobile-audit-allowlist.json client/package.json
git commit -m "test(mobile): add 44px touch-target + layout audit harness"
```

---

### Task 6: Audit→fix loop

**Files:** whichever screens the harness flags.

- [ ] **Step 1: Run the audit and triage**

`node scripts/mobile-audit.mjs`

For each finding decide: **fix** (the common case — raise the control to 44px, usually in a shared primitive so every screen benefits) or **allowlist** (only when the element is genuinely non-interactive-by-design, e.g. a decorative `[tabindex]` host). Every allowlist entry needs a reason string.

- [ ] **Step 2: Prefer fixing shared primitives over screens**

If the same `sel` appears on many routes, the fix belongs in `client/src/components/`. A per-screen override there would be a bug factory. Re-run after each primitive change — one fix often clears dozens of findings.

- [ ] **Step 3: Re-run and repeat**

Loop Steps 1-2 until `[mobile-audit] ok`. **Stop and report** if the finding count stops decreasing across two consecutive rounds — that means the remaining items need a design decision, not another pass.

- [ ] **Step 4: Full quality gate**

```bash
make quality
cd client && npx vitest run
```
Expected: `validate-repo: all selected checks passed`, all tests pass.

- [ ] **Step 5: Confirm on hardware**

```bash
cd client && npm run dev:vite -- --host 0.0.0.0 &
ADB=~/Library/Android/sdk/platform-tools/adb
$ADB shell am force-stop com.phantomptr.ps5upload
$ADB shell am start -n com.phantomptr.ps5upload/.MainActivity
# navigate to More on the device, then:
$ADB exec-out screencap -p > /tmp/more-after.png
```

Compare against the pre-change measurements in the spec §1. Confirm: full-width rows, one scroller, no clipped content behind the bottom nav.

- [ ] **Step 6: Commit**

```bash
git add -A client/src scripts
git commit -m "fix(mobile): raise sub-44px touch targets across screens"
```

---

## Self-Review

**Spec coverage:**
- §3 architecture (navItems.ts / More screen / TabNav / App.tsx / Sidebar) → Tasks 1-3 ✓
- §4 More screen + sizing contract → Task 2, verified Task 4 ✓
- §4 search behaviour (translated + English, diacritics, flat while searching) → Task 1 `filterNavItems` + tests, Task 2 rendering ✓
- §5 performance (lazy route, useMemo, no virtualization) → Task 2 Step 2 + memos ✓
- §6 audit harness incl. allowlist + limitation note → Task 5 ✓
- §7 testing (navItems.test.ts, harness, device screenshots) → Tasks 1, 5, 6 ✓
- §8 i18n → Task 2 Steps 3-4 ✓
- §9 out of scope: desktop TabRail untouched → stated in Global Constraints, Task 3 Step 1 keeps `Sidebar`/`X` imports ✓
- §10 iteration policy → Task 6 Step 3 ✓

**Placeholder scan:** no TBD/TODO; every code step has real code; the audit-loop task is inherently iterative but has an explicit stop condition rather than a vague "handle findings".

**Type consistency:** `NavItem`, `NavGroup`, `TrFn`, `NAV_ITEMS`, `groupNavItems`, `filterNavItems` are defined in Task 1 and used with those exact names in Tasks 1-2. `MoreRow` props match its call sites. `tr(key, vars?, fallback?)` used in the three-arg form throughout.

**Known gap accepted:** Task 3 Step 1 items 4-5 say "keep it" for the `X` and `Sidebar` imports — correct, because `TabRail` in the same file still uses both.
