# Android "More" redesign + mobile sizing audit

**Date:** 2026-08-04
**Status:** Approved
**Scope:** Replace the mobile More sheet with a full-screen search-first
route, then audit and fix touch-target / layout sizing across every mobile
screen.

---

## 1. Problem

The mobile "More" tab renders the desktop `<Sidebar>` verbatim inside a
bottom sheet (`TabNav.tsx:401`). `Sidebar` is a fixed-width `w-60`
full-height rail built for a mouse. Dropping it into a sheet produces a
UI that is broken on every axis we can measure.

Measured on a Pixel 9 Pro XL (1344×2992 physical, density 480 → **448×997
CSS px**), via `getBoundingClientRect` on the live DOM:

| Measurement | Value | Violates |
|---|---|---|
| `<aside>` width inside a 448px sheet | **270px** → 178px (40%) dead | mobile-design §3.3 (xs drawer = 100vw) |
| `<aside>` content height inside a ~798px sheet | **1858px** | — |
| Nav row height (all 38 rows) | **36px** | mobile-design §4.1 (≥44×44px on touch) |
| Interactive elements under 44px | **38 of 38** | mobile-design §4.1 |
| Nested scroll containers | **2** (`div.overflow-y-auto` > `nav.overflow-y-auto`) | — |
| Headers stacked | **2** (sheet "More" bar + Sidebar brand/logo/version) | — |

The nested scrollers are the defect commit `5fa30b53` ("More sheet
scroll") attempted to patch. The patch treated a symptom; the cause is
that a full-height component is nested inside a height-capped sheet.

Note: `w-60` is 240px at a 16px root, but measured 270px because the app
supports font-size zoom (mobile-design §6.4), which scales rem-based
widths. Fixed rem widths are therefore actively harmful on mobile — they
grow with user font settings while the viewport does not.

## 2. Decisions

Three forks were resolved with the user:

1. **More becomes a full-screen, search-first route** (`/more`) — not a
   sheet, not an icon grid. Rationale: it scales as screens are added,
   makes any of ~38 destinations reachable in one search, and eliminates
   the nested-scroll class of bug structurally rather than by patching.
2. **Utility affordances stay on the More screen, in zones.** The console
   switcher (`RosterPicker`) pins above the search box; theme toggle,
   notification inbox and app version form a footer row. Nothing that
   exists today is lost.
3. **Scope is More + an app-wide touch-target audit.** The 36px row
   problem is not unique to More, so the redesign is followed by a
   measured sweep of every mobile route.

**The desktop rail drawer (`TabRail`, md+) is deliberately left
unchanged.** It is not broken — a 240px sidebar inside a drawer on a wide
viewport is fine — and leaving it alone keeps the blast radius small.

## 3. Architecture

The root cause of the reuse failure is that nav *data* and nav *rendering*
are fused inside `Sidebar.tsx` (512 lines: a ~190-line `items` array,
grouping, collapse state, brand header, theme toggle). Mobile cannot reuse
the data without inheriting the desktop chrome. Splitting them is a
prerequisite, not a nice-to-have.

### New files

| File | Responsibility | Depends on |
|---|---|---|
| `client/src/layout/navItems.ts` | `NavItem` type, the `items` array, `groupNavItems()`, and pure `filterNavItems(items, query, tr)` | i18n `tr` only |
| `client/src/screens/More/index.tsx` | The `/more` route | `navItems`, `RosterPicker`, `NotificationInbox`, primitives |
| `scripts/mobile-audit.mjs` | Playwright harness that measures every route | Playwright, a running dev server |
| `scripts/mobile-audit-allowlist.json` | Accepted exceptions, shaped like `i18n-known-missing.json` | — |

### Changed files

- **`TabNav.tsx`** — the mobile More button becomes `<NavLink to="/more">`;
  the entire mobile sheet block is deleted. This removes the nested
  scroller and the duplicate header together.
- **`App.tsx`** — register `/more`, `lazy()`-loaded like every other screen.
- **`Sidebar.tsx`** — imports from `navItems.ts`; drops ~190 lines and
  keeps only desktop rendering.

Each unit answers the three questions cleanly: `navItems.ts` is data +
one pure function with no React dependency; `More/index.tsx` renders and
owns no nav data; `Sidebar.tsx` renders the desktop variant only.

## 4. The More screen

```
┌─────────────────────────────┐
│ More                        │  PageHeader
├─────────────────────────────┤
│  ● PS5 Pro      192.168…  ▾ │  RosterPicker — pinned, not scrolled
│  🔍 Search screens…         │  48px, sticky
├─────────────────────────────┤ ← ONE scroll container
│  SETUP                      │
│   🔌  Connection          › │  56px
│   📦  Payloads            › │  56px
│  FILES                      │
│   ⬆   Upload              › │
├─────────────────────────────┤
│  🌙 PS5 Dark   🔔 3   v5.0.0│  footer
└─────────────────────────────┘
```

### Sizing contract

- Rows: `min-h-14` (56px) — over the 44px floor with margin for the
  chevron and badge.
- Icons: 22px, matching the bottom nav.
- Search field: 48px tall.
- Every row is full-bleed tappable across the full viewport width.
- Bottom padding: `env(safe-area-inset-bottom)` **plus** the bottom-nav
  height, so the last row is never trapped under the nav.
- **No fixed `w-*` on any container.** Widths are fluid; see §1 on why rem
  widths interact badly with font-size zoom.

### Search behaviour

- Matches against **both** the translated label and the English fallback,
  so "hardware" finds Hardware in any of the 18 locales.
- Case- and diacritic-insensitive (`toLocaleLowerCase()` +
  `normalize("NFD")` with combining marks stripped).
- While a query is active, section headers are dropped and results render
  flat — grouping is noise once the list is already narrowed.
- Empty state when nothing matches.

## 5. Performance

- The route is `lazy()`-loaded, consistent with every other screen.
- Filtering is a `useMemo` over 38 items. **Virtualization is explicitly
  rejected** — 38 rows does not justify it, and it would cost more in
  complexity and scroll-jank risk than it saves.
- The old sheet re-mounted `RosterPicker` and `NotificationInbox` on every
  open. As a route they mount on navigation instead: the same work, but no
  longer on a tap that is supposed to feel instant.

## 6. Audit harness

**As-built note.** The original plan had `scripts/mobile-audit.mjs`
importing Playwright directly. Playwright turned out not to be installed
anywhere in the repo, and the root `package.json` deliberately carries
zero devDependencies — adding a browser driver would mean a ~500 MB
download on every dev machine and CI runner. The harness was therefore
split: `scripts/mobile-audit-probe.mjs` holds the probe, allowlist
filtering and report formatting with **no driver dependency**, injectable
into whatever automation is available, and runs standalone if Playwright
is ever installed.

One correctness change came out of running it: the probe unions a
checkbox/radio with its `<label for>` before measuring. Those controls
are drawn at ~20 px on purpose, and what the user taps is the control
*plus* its label — measuring the bare input reports a false failure on a
correctly-built row.

`scripts/mobile-audit-probe.mjs` walks every route at 448×997 and reports:

1. Interactive elements (`a`, `button`, `[role=button]`, `input`,
   `select`, `textarea`) that are **visible** (non-zero box, not
   `display:none`/`visibility:hidden`) and under 44px in either axis.
2. Nested scroll containers (a scrollable element inside another).
3. Horizontal overflow (`body.scrollWidth > body.clientWidth`).

Output: JSON plus a human summary. Exits non-zero when findings exist.
Genuine exceptions go in `mobile-audit-allowlist.json`, keyed by route and
selector, mirroring the existing i18n gate convention.

**"0 findings" is the finish line** — a checkable condition, unlike "looks
good".

### Known limitation

The harness runs the **browser** build at Android's viewport. That covers
layout, sizing and overflow. It does **not** cover WebView-specific
rendering, real touch behaviour, or safe-area insets as the device
actually reports them. Final confirmation is screenshots on the physical
Pixel.

## 7. Testing

- `client/src/layout/navItems.test.ts` — unit tests for `filterNavItems`
  and `groupNavItems`. Both are pure, matching the repo convention of
  testing logic in modules (77 `.test.ts`) rather than screens (2
  `.test.tsx`).
- The audit harness serves as the integration test.
- Manual confirmation via `adb exec-out screencap` on the Pixel.

## 8. i18n

New keys (`more_title`, `more_search_placeholder`, `more_no_results`,
`more_section_*`, …) are added to `en.ts` and allowlisted in
`scripts/i18n-known-missing.json` for the other 18 locales — the same flow
every existing `game_hub_*` and nav key already follows. `make quality`
enforces this.

## 9. Out of scope

- The desktop `TabRail` drawer (§2).
- Typography scale, spacing rhythm, and shared-primitive density — a
  larger design-system pass the user explicitly deferred.
- Tauri iOS (not shipped; mobile-design §7).

## 10. Iteration policy

The audit→fix→re-measure cycle runs until the harness reports zero, not
for a fixed number of passes. If findings stop decreasing across
consecutive rounds, stop and report rather than churn.

**Outcome:** converged in five rounds — routes with findings went
18 → 10 → 7 → 5 → 3 → 0 across 41 routes / 236 interactive elements.
Nothing was allowlisted; every finding was a real defect. Most of the app
was fixed by six shared-primitive edits (Button, IconButton, Toggle,
SegmentedControl, Checkbox, and one `index.css` media query for
`.input`/`.select`); the remainder were hand-rolled controls that
bypassed the primitives.

**Methodology trap worth recording:** after a CSS change, the sweep must
start from a full page load. Tailwind regenerates utilities on scan, and
an in-page (`pushState`) sweep against a hot-reloaded page measured stale
styles — it reported a fix as ineffective when it had actually worked.
