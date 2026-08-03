# v5 Accessibility, Visual Design Language & Component Primitives

**Scope:** Loops 71-80. This document is the canonical specification for:
1. **Accessibility (a11y)** — WCAG 2.2 AA conformance, screen-reader support, keyboard navigation, focus management, reduced-motion/high-contrast/dyslexia modes.
2. **Visual design language** — the refinement of the v3 "Control Deck" system into v5: tokens, typography, color, elevation, motion, iconography, glassmorphism, density modes.
3. **Component primitives** — the complete shared component library API, replacement plan, and migration from the 100+ raw `<input>`/`<select>`/`<textarea>` scattered across 41 screens.

**Supersedes:** §8 (UI Component Overhaul), §10 (Visual Design Language), Appendix C (Component API Sketches) of `v5-design.md`. All other sections of v5-design stand.

**Cross-references:**
- `v5-cross-cutting-concerns.md` §1.2 (touch targets), §5 (navigation/keyboard shortcuts), §6 (error/empty/toast), §6.6 (haptics) — this doc expands those into full specs.
- `v5-mobile-design.md` §6 (Android WebView), §14 (a11y on mobile) — this doc is the desktop+mobile canonical; mobile-specific notes are cross-referenced, not duplicated.
- `v5-home-console-redesign.md` — consumes these primitives (Home widgets, Console sections).
- `game-hub-revised-design.md` — consumes Tabs, Card, Badge, Spotlight, EmptyState.
- `v5-file-browser-redesign.md` — consumes Table, ContextMenu, Breadcrumbs, selection primitives.

**Relationship to existing code:** This doc specifies what to BUILD. The current primitives (`Button`, `Card`, `Modal`, `OverflowMenu`, `ProgressBar`, `EmptyState`, `ErrorCard`, `ConfirmDialog`, `TabbedShell`) are the baseline; this doc prescribes their v5 evolution plus the **21 NEW primitives** *(R24, loops 81-90: was "~15", corrected to actual count)* that close the gap.

---

## Table of Contents

1. [Accessibility Conformance Target](#1-accessibility-conformance-target)
2. [Current State Audit](#2-current-state-audit)
3. [Keyboard Navigation Specification](#3-keyboard-navigation-specification)
4. [Focus Management](#4-focus-management)
5. [Screen Reader Support](#5-screen-reader-support)
6. [Color & Contrast](#6-color--contrast)
7. [Motion Sensitivity](#7-motion-sensitivity)
8. [Cognitive & Reading Accessibility](#8-cognitive--reading-accessibility)
9. [Touch Accessibility](#9-touch-accessibility)
10. [A11y Testing Strategy](#10-a11y-testing-strategy)
11. [Visual Design Language — Token System](#11-visual-design-language--token-system)
12. [Typography](#12-typography)
13. [Color System](#13-color-system)
14. [Elevation & Depth](#14-elevation--depth)
15. [Motion Language](#15-motion-language)
16. [Iconography](#16-iconography)
17. [Density Modes](#17-density-modes)
18. [Glassmorphism & Surfacing](#18-glassmorphism--surfacing)
19. [Component Primitive Library — Full API](#19-component-primitive-library--full-api)
20. [Migration Plan](#20-migration-plan)
21. [Accessibility Settings Panel](#21-accessibility-settings-panel)
22. [Implementation Phasing](#22-implementation-phasing)

---

## 1. Accessibility Conformance Target

### 1.1 Target: WCAG 2.2 Level AA

ps5upload targets **WCAG 2.2 AA** as the conformance baseline. This is the current W3C Recommendation (as of 2023-10-05). Level AAA is not pursued as a blanket target (WCAG itself notes AAA is "not required for entire sites"), but specific guidelines where AAA is straightforward (e.g. 1.4.6 Contrast Enhanced via the High Contrast mode) are met in the enhanced modes.

**Why AA, not A:**
- This is a power-user tool (jailbroken-PS5 management); users include visually-impaired gamers who depend on assistive tech. Level A is insufficient for `1.4.3 Contrast (Minimum)` at our dark theme's low-chroma palette.
- The Tauri webview ships to macOS, Windows, Android, and (future) iPadOS — all platforms where users may invoke built-in screen readers (VoiceOver, Narrator, TalkBack).
- Several competitors in the PS5 homebrew space are entirely inaccessible (keyboard-only users can't even navigate them). Full a11y is a genuine differentiator.

### 1.2 Guidelines addressed (notable)

| Guideline | Level | Current status | v5 target |
|-----------|-------|----------------|-----------|
| 1.1.1 Non-text Content | A | Partial (decorative icons mostly `aria-hidden`, but some informative icons lack labels) | All informative icons get `aria-label`; decorative stay `aria-hidden` |
| 1.3.1 Info and Relationships | A | Partial (TabbedShell has ARIA, most tables/data-grids don't) | All data structures use semantic HTML or ARIA |
| 1.3.2 Meaningful Sequence | A | OK (DOM follows visual order in most screens) | Verified per screen |
| 1.4.1 Use of Color | A | FAIL in places (status conveyed by color alone in some chips) | Always pair color with icon/text |
| 1.4.3 Contrast (Minimum) 4.5:1 | AA | Borderline — `--color-muted` at 0.66 L on 0.17 surface ≈ 4.2:1 | All text tokens verified ≥ 4.5:1 |
| 1.4.4 Text Spacing | AA | OK (`text-size-adjust: 100%`) | Verified |
| 1.4.10 Reflow | AA | OK (`min-width: 0`, `overflow-wrap`) | Verified at 320 CSS-px |
| 1.4.11 Non-text Contrast 3:1 | AA | Borderline — focus ring is 2px on accent, some icon-only buttons lack visible boundary | All interactive icons get 3:1 boundary |
| 1.4.12 Text Spacing | AA | OK (system font stack reflows) | Verified |
| 2.1.1 Keyboard | A | Partial — TabbedShell, Modal, OverflowMenu OK; many screens have mouse-only interactions (drag-drop, context menus) | All features keyboard-reachable |
| 2.1.2 No Keyboard Trap | A | OK (Modal restores focus, Escape works) | Verified |
| 2.4.1 Bypass Blocks | A | MISSING — no skip-nav link | Add skip-to-main link |
| 2.4.3 Focus Order | A | Mostly OK | Verified per screen |
| 2.4.7 Focus Visible | AA | OK globally (`:focus-visible` in index.css) | Maintain; add for custom widgets |
| 2.5.5 Target Size (Minimum) | AA (2.5.8 in 2.2) | FAIL — most buttons are 28px | ≥ 24×24 CSS-px (AA), 44×44 for touch |
| 3.2.1 On Focus | A | OK | Maintain |
| 3.3.1 Error Identification | A | Partial — `ErrorCard` exists, field-level validation is ad-hoc | Field errors via `<Input error>` |
| 3.3.2 Labels or Instructions | A | Partial — many inputs lack `<label>` association | All form controls labeled |
| 3.3.3 Error Suggestion | A | MISSING — errors rarely suggest a fix | Field errors include suggestion |
| 4.1.2 Name, Role, Value | A | Partial — custom widgets need full ARIA | All custom widgets complete ARIA |
| 4.1.3 Status Messages | AA | Partial — `ErrorCard` has `aria-live`, no global live region | Global `aria-live="polite"` region |

### 1.3 Reporting

The Bug Report modal (Console → Tools in v5) gains an **"Accessibility issue"** category. Users can report a11y bugs with one tap; the report auto-includes: active theme, uiScale, viewport size, input mode (mouse/touch/keyboard), and whether a screen reader is detected (via `navigator.userAgentData` heuristics — never definitive, but helpful context).

---

## 2. Current State Audit

### 2.1 Primitives that exist (and their quality)

| Component | File | A11y status | v5 action |
|-----------|------|-------------|-----------|
| `Button` | `Button.tsx` | Good — uses global `:focus-visible`. **Default size is `sm` (36px)** — fails touch target. | **Change default to `md` (44px).** Add `lg` size. |
| `Card` | `Card.tsx` | OK as static container. No interactive variant. | Add `interactive` prop (onClick → button semantics, hover lift). |
| `Modal` | `Modal.tsx` | **Excellent** — `role=dialog`, `aria-modal`, `aria-labelledby`, focus trap, Escape, scroll lock, focus restore. | Keep. Add `variant="sheet"` for mobile bottom-sheet. |
| `ConfirmDialog` (`useConfirm`/`useAlert`/`usePrompt`) | `ConfirmDialog.tsx` | **Excellent** — `role=alertdialog`, full ARIA, focus restore. Prompt input uses raw `<input>` not `.input` class. | Fix prompt input styling. Otherwise keep. |
| `OverflowMenu` | `OverflowMenu.tsx` | Good — `role=menu`, `role=menuitem`, `aria-haspopup`, `aria-expanded`, outside-click, Escape, flip-up. **Missing:** arrow-key navigation within menu, `aria-activedescendant` or roving focus. | Add arrow-key nav (Up/Down/Home/End). |
| `TabbedShell` | `layout/TabbedShell.tsx` | **Excellent** — full WAI-ARIA tabs pattern (Left/Right/Home/End, `aria-controls`, `aria-selected`, follow-focus). | Promote to `components/Tabs.tsx` (generalize beyond URL-synced). |
| `ProgressBar` | `ProgressBar.tsx` | Good — `role=progressbar`, `aria-valuemin/max/now`. **Missing:** `aria-label` always required (indeterminate bars are unnamed). | Add `label` prop (required). |
| `EmptyState` | `EmptyState.tsx` | OK — no `role`, no live region. | Add optional `role="status"` for async-empty (loading → empty transition should announce). |
| `ErrorCard` / `SuccessCard` / `WarningCard` | `ErrorCard.tsx` | Good — `role=alert`/`role=status`, `aria-live`. Three components with near-identical bodies. | **Consolidate** to one `<Callout tone="error|warn|success|info">`. |
| `RootErrorBoundary` | `ErrorBoundary.tsx` | Good — `role=alert`, `aria-live="assertive"`, logs to store. **Broken CSS tokens:** `--color-bg` (nonexistent), `--color-surface-hover` (nonexistent), `text-white`. | Fix tokens. Add per-tab variant (cross-cutting §6.2). |
| `Skeleton` / `SkeletonRows` / `ShapesLoader` | `Skeleton.tsx` | OK — `aria-hidden`. **Missing:** `aria-busy` on the container that will receive the loaded content. | Add `aria-busy` guidance (container, not skeleton). |
| `PageHeader` | `PageHeader.tsx` | Untyped `<header>` with no `role`. | Add `<header>` as landmark, optional `aria-label`. |
| `ConsoleChip` | `ConsoleChip.tsx` | OK — `aria-hidden` on decorative dot. | Keep. |
| `GameIcon` | `GameIcon.tsx` | No `alt` on the `<img>`. | Add `alt` prop (default: game title; `""` for decorative). |
| `MarkdownView` | `MarkdownView.tsx` | Renders semantic HTML from markdown. | Keep; ensure headings hierarchy. |
| `CommandPalette` | `CommandPalette.tsx` | Partial — `role=dialog`. Missing: `role=combobox`, `aria-expanded`, `aria-activedescendant`, `aria-controls` on the input; `role=option` + `aria-selected` on items. | Implement WAI-ARIA Combobox with Listbox pattern. |
| `ConnectionGate` | `ConnectionGate.tsx` | OK. | Keep. |
| `ShortcutsOverlay` | `ShortcutsOverlay.tsx` | Modal with shortcuts list. | Keep; ensure it's in the tab order (openable via `?`). |
| `LocalPathPicker` | `LocalPathPicker.tsx` | Raw button + hidden input. | Wrap in primitive Button. |
| `PlatformBadge` | `PlatformBadge.tsx` | Decorative. | Keep. |

### 2.2 Primitives that DON'T exist (and must be built)

| Primitive | Why needed | Consumed by |
|-----------|-----------|-------------|
| `IconButton` | 100+ raw `<button>` with just an icon. Each re-implements `aria-label`, size, focus. | Every screen with icon-only actions (close, refresh, delete-row) |
| `Input` | 100+ raw `<input>`. No label association, no error display, no hint text. | Every form field (Settings ×15, FtpServer ×5, Backup ×2, Search, RemotePlay, etc.) |
| `Select` | 30+ raw `<select>`. Unstyled, no label. | Settings (language, default tab), Profile, Upload, Search filters |
| `Textarea` | 5+ raw `<textarea>`. | BugReport, Shell input, Cheats notes |
| `Checkbox` | 40+ raw `input[type=checkbox]`. No label association, visual-only. | Settings (every toggle), Upload options, InstallPackage, FtpServer |
| `Toggle` (Switch) | **MISSING entirely** — Settings uses `checkbox` for binary settings that should be switches. | Settings (all boolean settings), FtpServer, RemotePlay |
| `RadioGroup` | 5+ raw `input[type=radio]` groups. | Settings (theme cycle should be this), Upload (mirror targets), Backup scope |
| `Tabs` (general) | `TabbedShell` is URL-synced only. Game Hub needs state-synced tabs. | Game Hub (8 tabs), File Browser view modes |
| `Badge` / `Tag` | 50+ inline `<span>` with badge classes. | Games tab counts, Task status, Console status chips |
| `Tooltip` | **MISSING entirely.** 20+ `title=""` attributes (native tooltips — ugly, no a11y, no theming, no delay). | Disabled buttons (cross-cutting: "PS5 offline" tooltip everywhere), abbreviations, truncation hints |
| `Table` / `DataGrid` | 15+ raw `<table>` or `<div>` grids with no ARIA. | Processes (already has `role`), AuditLog, Logs, Activity, Tmdb, Saves |
| `Drawer` | Sidebar drawer is hand-rolled in AppShell. Cross-cutting §3 calls for a reusable Drawer. | AppShell mobile drawer, Tasks filters panel, Settings sub-nav |
| `Sheet` (Bottom Sheet) | **MISSING.** Mobile pattern for modals, filters, pickers. | Mobile modal variant, mobile file actions, mobile task actions |
| `ContextMenu` | **MISSING.** Right-click on desktop, long-press on mobile. | File browser rows, Game grid tiles, Saves rows |
| `Toaster` / `useToast` | **MISSING.** Cross-cutting §6.5 calls for one `<Toaster>` at app root. Currently no in-app transient feedback (only PS5-side `toastPush`). | Every action that needs confirmation feedback ("Settings saved", "Task queued") |
| `Spinner` | Uses `Loader2` from lucide directly. | Button loading, inline loading |
| `SkipNav` | **MISSING.** WCAG 2.4.1. | App root |
| `LiveRegion` (announcer) | **MISSING.** WCAG 4.1.3. | App root — announces route changes, task completions |
| `Spotlight` | **MISSING.** v5-design §10.1 / Appendix C. Games tab hero panel. | Games tab |
| `SegmentedControl` | **MISSING.** File Browser view modes, Activity view toggle (currently raw buttons). | File Browser (list/grid/tree/du), Activity (list/timeline), Media (screenshots/videos) |
| `Breadcrumb` | **MISSING.** File Browser needs breadcrumbs. | File Browser, SMB browser |

### 2.3 The ErrorBoundary broken tokens (confirmed)

In `ErrorBoundary.tsx`:
- Line 92: `bg-[var(--color-bg)]` — **`--color-bg` does not exist** in any theme. The element renders with transparent background (falls through to `#root` surface). Should be `--color-surface`.
- Line 119: `hover:bg-[var(--color-surface-hover)]` — **`--color-surface-hover` does not exist.** The "Try again" button has no hover state. Should be `--color-surface-3`.
- Line 127: `text-white` — hard-coded; in the OLED theme the bad-soft background is near-black and the accent-contrast is also black, so `text-white` is visually OK but **violates the theme system** (should be `--color-accent-contrast`).

These are fixed in the migration (§20).

---

## 3. Keyboard Navigation Specification

### 3.1 Global keyboard shortcuts (v5 canonical)

Cross-cutting §5.3 defines the keyboard map. This section specifies the a11y contract for each.

| Shortcut | Action | A11y note |
|----------|--------|-----------|
| `Tab` / `Shift+Tab` | Move focus through tabbable elements | Global `:focus-visible` ring (already implemented) |
| `⌘K` / `Ctrl+K` | Open Command Palette | Palette uses combobox pattern (§5.4) |
| `⌘,` / `Ctrl+,` | Open Settings |  |
| `⌘/` / `Ctrl+/` | Open Shortcuts Overlay | Overlay is a Modal; focus trapped |
| `?` | Open Shortcuts Overlay (alternative) |  |
| `g` then `h` | Go to Home | Two-key chord; announces "Home" via LiveRegion |
| `g` then `g` | Go to Games |  |
| `g` then `f` | Go to Files |  |
| `g` then `c` | Go to Console |  |
| `g` then `t` | Go to Tasks |  |
| `1`-`5` | Switch primary tab (when not in input) | Disabled when focus is in a text field |
| `Esc` | Close modal / menu / palette | Each component handles its own Escape |
| `F5` / `⌘R` | Refresh current screen's data | Screen defines its own refetch |

### 3.2 Per-component keyboard contracts

#### Button
- `Enter` → activates (native `<button>` default).
- `Space` → activates (native default).
- Focus ring via global `:focus-visible`.

#### IconButton
- Same as Button. **`aria-label` is required** (no visible text).

#### Tabs (WAI-ARIA Tabs pattern — already in TabbedShell)
- When a tab has focus: `←`/`→` move (cyclic), `Home`/`End` jump to first/last.
- Activation is on click OR on arrow (follow-focus model — cross-cutting §5.3 confirms "follow-focus").
- `tabindex`: active tab is `0`, others are `-1` (roving tabindex).

#### OverflowMenu / ContextMenu (WAI-ARIA Menu pattern)
- Trigger: `Enter`/`Space`/`↓` opens the menu and focuses first item.
- Within menu: `↑`/`↓` move (cyclic), `Home`/`End` jump, `Esc` closes + returns focus to trigger, `Enter` activates item.
- **NEW (currently missing):** arrow-key navigation within `OverflowMenu`. Currently only click/Escape work.

#### Modal (already implemented)
- `Esc` closes (unless `closeOnScrim=false` AND no other close affordance).
- Focus trapped within panel (first focusable on open, restored on close).

#### Combobox (Command Palette — WAI-ARIA Combobox pattern)
- Input: `role="combobox"`, `aria-expanded="true"` when open, `aria-controls` → listbox id, `aria-activedescendant` → active option id, `aria-autocomplete="list"`.
- `↓`/`↑` move active option (does NOT move input focus or selection), `Enter` activates, `Esc` closes.
- Listbox: `role="listbox"`. Each option: `role="option"`, `aria-selected` on the active one.
- **Current CommandPalette is missing all of this.** v5 rewrites it.

#### Dialog (Confirm/Alert/Prompt — already good)
- `alertdialog` role. `Esc` = cancel, `Enter` = confirm. Focus auto-on confirm/OK button.

#### Drawer
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Same focus management as Modal.
- `Esc` closes.

#### Sheet (Bottom Sheet)
- Same as Drawer but slides from bottom.

#### Tooltip
- Trigger: focusable element (`button`, `a`, or `[tabindex="0"]` with `aria-describedby` → tooltip id).
- Tooltip appears on `:hover` AND `:focus-visible` (keyboard users need it too).
- `Esc` dismisses the tooltip.

#### Toast (non-interactive)
- `role="status"` (polite) or `role="alert"` (assertive — only for critical).
- NOT in the tab order. NOT focusable (would steal focus from the user's task).
- If a toast has an action button (e.g. "Undo"), the toast becomes focusable and the action button is reachable.

#### Table / DataGrid
- Standard `<table>` semantics for simple data. `scope="col"` / `scope="row"` on headers.
- For sortable columns: `aria-sort="ascending|descending|none"` on the header.
- For data-grids ( Processes, Task list): `role="grid"`, `role="row"`, `role="gridcell"`, arrow-key navigation (optional, per WAI-ARIA Grid pattern — only if the grid is the primary interaction surface).

### 3.3 Skip navigation

A visually-hidden "Skip to main content" link is the first focusable element in the DOM (before the left rail / bottom nav). On focus, it becomes visible (top-left, accent background). It jumps focus to `<main id="main">`.

```tsx
<a href="#main" className="skip-link">Skip to main content</a>
```

```css
.skip-link {
  position: absolute;
  left: -9999px;
  /* ... */
}
.skip-link:focus {
  left: 8px;
  top: 8px;
  z-index: 100;
  /* visible styles */
}
```

### 3.4 Focus ring specification

Already implemented globally in `index.css`:
```css
:where(a, button, [role="button"], [role="menuitem"], [role="tab"], [tabindex]):focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 6px;
}
```

v5 additions:
- `:where([role="option"]):focus-visible` — combobox options.
- `:where([role="gridcell"]):focus-visible` — data grid cells.
- **High-contrast mode** doubles the offset to 4px and thickens to 3px (§7).
- **Never** use `outline: none` without a replacement. The global rule uses `:focus-visible` so mouse clicks don't show a ring — but keyboard always does.

### 3.5 Reading order & DOM sequence

- DOM order MUST match visual order. No CSS `order` property to reorder flex children in a way that breaks tab sequence. (Current code is OK; verify during migration.)
- Decorative elements (icons, spacers) are `aria-hidden` so they're skipped by screen readers.
- In Game Hub, the 8 tabs come before the panel content in the DOM — screen readers announce the tab list, then the active panel.

---

## 4. Focus Management

### 4.1 Route changes

When the route changes (user clicks a nav tab, clicks a game, clicks a breadcrumb):
1. **Focus moves to the new page's `<h1>`** (the PageHeader title). The `<h1>` has `tabindex="-1"` so it can receive focus programmatically without being in the tab order.
2. The LiveRegion announces the page title (§5.3).
3. This matches the WAI-ARIA APG "rotor focus" pattern for single-page apps.

```tsx
// In each screen's root:
useEffect(() => {
  const h1 = headingRef.current;
  h1?.focus({ preventScroll: true });
}, []);
```

**Exception:** if the user clicked a link that opened a detail view (e.g. game tile → Game Hub), focus goes to the Game Hub's `<h1>`, and `Esc` (browser back) returns focus to the originating tile.

### 4.2 Modal open/close

Already implemented in `Modal.tsx` and `ConfirmDialog.tsx`:
- On open: save `document.activeElement`, move focus to first focusable in panel.
- On close: restore focus to saved element.

v5 ensures every overlay (Modal, Drawer, Sheet, Combobox, Menu, Tooltip) follows this.

### 4.3 List virtualization & focus

Mobile doc §15.3 mandates virtualization for lists > 100 rows. Virtualization must:
- Preserve `tabindex` on the virtualized items so keyboard navigation works.
- Use `aria-setsize` and `aria-posinset` on each row so screen readers know the list size and position.
- On `End`/`Home`, scroll the virtual window to the last/first item, then focus it.

### 4.4 Focus vs. selection

In multi-select lists (File Browser, Media gallery):
- Focus = the element that would receive keyboard input.
- Selection = the element(s) the user has chosen (highlighted).
- `Space` toggles selection of the focused item.
- `Enter` opens/activates the focused item.
- `Ctrl+A` / `⌘A` selects all.
- These are distinct — a screen reader announces both ("row 3 of 50, selected").

---

## 5. Screen Reader Support

### 5.1 Semantic HTML first

Before any ARIA: use semantic HTML. `<button>`, `<a>`, `<nav>`, `<main>`, `<header>`, `<table>`, `<form>`, `<fieldset>`, `<legend>`, `<label>`, `<h1>`-`<h6>` all convey semantics for free. ARIA is only added when HTML is insufficient (tabs, menus, comboboxes, live regions).

### 5.2 Landmark roles

v5 establishes a clear landmark structure on every screen:

```
[<nav> left rail / bottom nav — aria-label="Primary"]
[<a> skip link]
<main id="main">
  <header aria-label="<screen name>">
    <h1>Screen Title</h1>
  </header>
  <section aria-label="<section name>">...</section>
</main>
[<nav> status bar — aria-label="Status"]
```

Screen readers can jump between landmarks via rotor gestures. Each `<nav>`/`<main>`/`<header>`/`<section>` needs an `aria-label` when its purpose isn't obvious.

### 5.3 LiveRegion (global announcer)

A single `<div aria-live="polite" aria-atomic="true">` at the app root, fed by a Zustand store. Used for:
- Route changes: "Games" / "Files" / "Game Hub: Bloodborne".
- Task completions: "Upload complete: bloodborne.pkg".
- Settings changes: "Theme changed to Light".
- Clipboard ops: "Copied 3 items".

NOT for:
- Errors (those are inline `ErrorCard` with `role=alert`).
- Toasts (those are their own `role=status` regions).
- Loading states (use `aria-busy` on the container).

```tsx
// state/liveRegion.ts
interface LiveRegionState {
  message: string;
  announce: (msg: string) => void;
}
export const useLiveRegionStore = create<LiveRegionState>((set) => ({
  message: "",
  announce: (message) => {
    set({ message });
    // Clear after the SR has read it (prevents stale repeat).
    setTimeout(() => set({ message: "" }), 1000);
  },
}));
```

### 5.4 ARIA patterns (full implementations required)

| Pattern | WAI-ARIA APG reference | Where used |
|---------|----------------------|------------|
| Tabs | https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ | TabbedShell, Game Hub tabs, File Browser view modes |
| Menu / MenuButton | https://www.w3.org/WAI/ARIA/apg/patterns/menubutton/ | OverflowMenu, ContextMenu, Console user menu |
| Combobox with Listbox | https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ | Command Palette, Game search |
| Dialog (Modal) | https://www.w3.org/WAI/ARIA/apg/patterns/dialogmodal/ | Modal, ConfirmDialog, Drawer, Sheet |
| Alertdialog | https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/ | ConfirmDialog (destructive) |
| Disclosure | https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/ | Collapsible sections, FAQ items |
| Grid | https://www.w3.org/WAI/ARIA/apg/patterns/grid/ | Processes table (optional) |
| Listbox | https://www.w3.org/WAI/ARIA/apg/patterns/listbox/ | Multi-select file rows |
| Toolbar | https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/ | File Browser toolbar, Game Hub header actions |

### 5.5 Icon labeling

Three cases:

1. **Decorative icon** (icon repeats adjacent text): `<Icon aria-hidden />`. E.g. the Refresh icon inside a "Refresh" button.
2. **Informative icon** (icon conveys meaning, no adjacent text): icon-only `IconButton` → `aria-label="Refresh"`. The icon itself is `aria-hidden`; the button's label carries the meaning.
3. **Status icon** (icon conveys state, e.g. ✓ for success): `aria-label="Success"` on the icon, OR (better) wrap in an element with `role="img" aria-label="Success"`.

### 5.6 Image alt text

- `GameIcon` currently renders `<img>` with no `alt`. v5: `alt` prop, default to the game title, `""` when decorative (e.g. in a grid where the title is already shown below).
- Screenshots/videos in Media: `alt=""` (decorative — the filename is the label, shown below the thumbnail).
- Avatar images: `alt="<username>'s avatar"`.

---

## 6. Color & Contrast

### 6.1 Contrast audit of current tokens

| Token | Theme | L (foreground) | L (background) | Ratio | Pass 4.5:1? |
|-------|-------|----------------|-----------------|-------|-------------|
| `--color-text` on `--color-surface` | Dark | 0.955 | 0.17 | ~16:1 | ✓ |
| `--color-text` on `--color-surface-2` | Dark | 0.955 | 0.21 | ~14:1 | ✓ |
| `--color-muted` on `--color-surface` | Dark | 0.66 | 0.17 | ~4.2:1 | **✗** (borderline) |
| `--color-muted` on `--color-surface-2` | Dark | 0.66 | 0.21 | ~3.6:1 | **✗** |
| `--color-accent` on `--color-surface` | Dark | 0.7 | 0.17 | ~5.5:1 | ✓ (large only at 4.5) |
| `--color-good` on `--color-good-soft` | Dark | 0.72 | 0.3 | ~4.0:1 | **✗** |
| `--color-warn` on `--color-warn-soft` | Dark | 0.78 | 0.32 | ~4.3:1 | **✗** (borderline) |
| `--color-bad` on `--color-bad-soft` | Dark | 0.65 | 0.32 | ~2.8:1 | **✗** |

**v5 fix:** bump `--color-muted` to ≥ 0.70 L in all dark themes. Bump semantic text colors (good/warn/bad when used as text on their soft backgrounds) so the pair clears 4.5:1. The `-soft` backgrounds are tinted toward the semantic hue, so the foreground needs more lightness.

**New dark-theme tokens (proposed):**
```css
--color-muted: oklch(0.70 0.025 252);  /* was 0.66 → now 4.6:1 on surface */
--color-good: oklch(0.78 0.14 150);     /* was 0.72 → 4.8:1 on good-soft */
--color-warn: oklch(0.82 0.15 75);      /* was 0.78 → 5.0:1 on warn-soft */
--color-bad: oklch(0.72 0.2 25);        /* was 0.65 → 4.1:1 on bad-soft — still short, see below */
```

For `--color-bad` on `--color-bad-soft`: the bad-soft is already quite saturated (0.32 L, 0.10 C). The cleanest fix is to darken bad-soft slightly to 0.26 L, which lifts the ratio to 4.8:1 without changing the bad text color much. **`ErrorCard` is the primary consumer — its text is already bold and larger, so 3:1 (large-text minimum) applies**, but we aim for 4.5:1 for body text usage (e.g. inline error hints).

### 6.2 Never color alone

WCAG 1.4.1. Status conveyed by color must also have a text or icon cue.

**Violations in v4:**
- Connection status dot (green = connected, red = offline) — only color. **v5:** pair with an icon (✓ / ✗ / ⏳) AND text label.
- Console chip platform color (blue = PS4, violet = PS5) — only color. **v5:** the chip already has "PS4"/"PS5" text; verify the text is always rendered, not just color.
- Success/Error/Warning cards — already have icons (✓ / ⚠ / ✗). OK.
- Task status badges — "Running", "Done", "Failed" text. OK.

### 6.3 High contrast mode

A Settings toggle: **"High contrast"** (off by default — our default dark theme already aims for AA). When ON:
- Forces the OLED theme (pure black background).
- Bumps border strength: `--color-border` → `--color-border-strong`.
- Doubles focus ring width to 3px, offset to 4px.
- Disables the atmosphere gradient (already done in OLED).
- Bumps text lightness: `--color-muted` → `--color-text` L (effectively unmutes all secondary text).

Implemented as `:root[data-theme="oled"][data-contrast="high"]` overrides in CSS.

```css
:root[data-contrast="high"] {
  --color-border: var(--color-border-strong);
  --color-muted: var(--color-text);
}
:root[data-contrast="high"] :where(a, button, [tabindex]):focus-visible {
  outline-width: 3px;
  outline-offset: 4px;
}
```

Also respects `@media (prefers-contrast: more)` — if the OS asks for more contrast, the high-contrast mode auto-enables on first launch (user can override).

### 6.4 Color blindness

The semantic palette (good=green, warn=yellow, bad=red) is a classic red/green confusion for deuteranopia/protanopia (~5% of male users). Mitigations:
- **Icons always accompany color.** ✓ for good, ⚠ for warn, ✗ for bad. Never color alone (§6.2).
- The PS4 (blue) / PS5 (violet) badge pair is blue-vs-purple — distinguishable for most color-blind users because the hues are far apart (255 vs 295) even if saturation drops.
- A "Color blind" setting (Settings → Accessibility) swaps the semantic palette to a color-blind-safe set (blue/orange/good=blue, warn=orange, bad=magenta), using Okabe-Ito-inspired hues. **Optional** — the icon pairing is the primary mitigation; this is for users who prefer it.

---

## 7. Motion Sensitivity

### 7.1 Current state

Already implemented in `index.css`:
```css
@media (prefers-reduced-motion: reduce) {
  .anim-scrim, .anim-pop, .anim-rise, .anim-screen,
  .anim-drawer, .anim-sheet, .anim-skeleton, .anim-status-pulse {
    animation: none;
  }
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

This is good — `prefers-reduced-motion` nukes all animation. v5 keeps this and adds finer control.

### 7.2 v5 motion settings (Settings → Accessibility)

| Setting | Values | Effect |
|---------|--------|--------|
| Motion | "Full" (default) / "Reduced" / "None" | Full = all animations. Reduced = durations halved, no parallax, no hover-lift. None = no animation at all. |
| Auto-detect | on/off | When on, reads `prefers-reduced-motion`; "Reduced" if OS says reduce, else "Full". |

Implementation: a `data-motion="full|reduced|none"` attribute on `<html>`. CSS scopes animations:

```css
:root[data-motion="reduced"] .anim-pop { animation-duration: 90ms; }
:root[data-motion="reduced"] .anim-screen { animation: none; }
:root[data-motion="none"] .anim-pop,
:root[data-motion="none"] .anim-screen,
:root[data-motion="none"] .anim-drawer,
:root[data-motion="none"] .anim-sheet,
:root[data-motion="none"] .anim-skeleton,
:root[data-motion="none"] .anim-status-pulse { animation: none; }
:root[data-motion="none"] *, 
:root[data-motion="none"] *::before, 
:root[data-motion="none"] *::after {
  transition-duration: 0.01ms !important;
}
```

### 7.3 Parallax & hover-lift (new in v5 Games tab)

The Spotlight panel (v5-design §10.1) uses a subtle parallax on the blurred backdrop and a `translateY(-3px)` lift on game tile hover. Both are **disabled** under "Reduced" and "None" motion modes. The hover-lift is a `transition` so "None" kills it via the universal transition-duration override.

---

## 8. Cognitive & Reading Accessibility

### 8.1 Text size (already implemented)

`state/uiScale.ts` controls `--ui-base-size` on `<html>`. Range: 80%–150%. Persisted. Applied before React mounts (no flash). Already respects Android's system font scale (§6.4 of mobile doc).

### 8.2 Dyslexia-friendly mode

A Settings toggle: **"Dyslexia-friendly font"** (off by default). When ON:
- Swaps the system font stack for a dyslexia-friendly stack (if installed): `"OpenDyslexic", "Atkinson Hyperlegible", system-ui, ...`.
- Both OpenDyslexic and Atkinson Hyperlegible are free. We CANNOT bundle them in the binary (license + size) — but we can document installation and gracefully fall back to system-ui if absent.
- **Atkinson Hyperlegible** (by the Braille Institute) is the better default recommendation — designed for low-vision readers, free, and visually close to the system stack. We document it as a recommended install; if present in the system font list, it's used.

Implementation: a `--font-dyslexia` token, applied via `data-dyslexia="true"` on `<html>`:
```css
:root[data-dyslexia="true"] body {
  font-family: "Atkinson Hyperlegible", "OpenDyslexic", system-ui, -apple-system, sans-serif;
  /* Slightly increased letter-spacing + line-height for readability. */
  letter-spacing: 0.01em;
  line-height: 1.5;
}
```

### 8.3 Line length & readability

- Content max-width: `max-w-7xl` (80rem) for wide screens (v5-design §8.4). For reading-heavy content (FAQ, Changelog, About): `max-w-2xl` (42rem) — the optimal line length for reading (45-75 characters per line).
- Paragraph spacing: `leading-relaxed` (1.625) for body text in MarkdownView.

### 8.4 Plain language

- Button labels: verb-first, 1-3 words. "Upload", "Delete file", "Connect PS5". Not "OK" for destructive actions.
- Error messages: state what happened + what to do. "Upload failed: PS5 disk full. Free up space on the PS5 and try again." Not "Error: E_DISK_FULL".
- Empty states: cross-cutting §6.4 — imperative title, one-sentence body, single CTA.

### 8.5 Consistency (reduces cognitive load)

This is the whole point of the primitive library (§19). One Button, one Input, one Modal — users learn the pattern once, it applies everywhere. The v4 state of 41 screens each rolling their own input styling is a cognitive-load tax that v5 eliminates.

### 8.6 Timeouts

No time-limited interactions in ps5upload. Uploads/installs run as long as they take; the user is never "auto-logged-out". Sessions with the PS5 persist until the network drops. **WCAG 2.2.1 (Timing Adjustable) — N/A.**

---

## 9. Touch Accessibility

### 9.1 Touch target sizes

WCAG 2.5.8 (Target Size, Minimum) requires ≥ 24×24 CSS-px. The stricter 2.5.5 (Target Size, Enhanced, AAA) requires ≥ 44×44 CSS-px. Our target (cross-cutting §1.2, mobile §3) is **44×44 for all touch interactions**.

Current state: `index.css` has a `@media (pointer: coarse)` rule that sets `min-height: 44px` on buttons/selects/inputs. But:
- Icon-only buttons sized via `p-1` are ~28px — the `min-height` overrides them, but `min-width` is missing, so a square icon button is 44 tall but only 28 wide.
- Links (`<a>`) are NOT covered by the rule.

**v5 fix:**
```css
@media (pointer: coarse) {
  button, [role="button"], [role="menuitem"], [role="tab"],
  [role="option"], a, select, textarea,
  input:not([type="checkbox"]):not([type="radio"]) {
    min-height: 44px;
    min-width: 44px;
  }
}
```

And the primitive library (§19) enforces this at the component level — `IconButton` is always 44×44, `Button` `md` size is 44px tall, etc.

### 9.2 Touch gestures (mobile doc §4)

All gestures have a keyboard equivalent (WCAG 2.5.x Pointer Cancellation):
- Swipe → arrow keys.
- Long-press → right-click / `Shift+F10` (context menu).
- Pinch-to-zoom → `+`/`-` keys.
- Pull-to-refresh → `F5`.

### 9.3 300ms tap delay

Already addressed by the planned `touch-action: manipulation` on buttons (v5-design §9.4). This removes the 300ms double-tap-to-zoom delay on touch.

### 9.4 Tap highlight

Add `-webkit-tap-highlight-color: transparent` globally (Android WebView draws a semi-transparent gray rectangle on tap by default; our components provide their own `:active` feedback).

---

## 10. A11y Testing Strategy

### 10.1 Automated testing

| Tool | Scope | Cadence |
|------|-------|---------|
| `@axe-core/playwright` | E2E tests on every screen | CI (every PR) |
| `eslint-plugin-jsx-a11y` | Lint rules (alt text, aria-props, role-support) | Pre-commit |
| `lighthouse` a11y audit | Overall score | Weekly / pre-release |

Axe rules enabled (strict):
- `color-contrast` (4.5:1)
- `aria-required-attr`, `aria-valid-attr`, `aria-roles`
- `button-name`, `link-name` (no empty labels)
- `label` (form controls must have labels)
- `tabindex` (no `tabindex > 0`)
- `focus-order-semantics`
- `click-events-have-key-events`
- `no-autofocus` (except Modal/Dialog)
- `region` (all content in landmarks)

### 10.2 Manual testing matrix

| Platform | Screen reader | Browser | Test |
|----------|--------------|---------|------|
| macOS | VoiceOver | Tauri WebView (WebKit) | Full nav per screen |
| Windows | NVDA | Tauri WebView (WebView2/Edge) | Full nav per screen |
| Windows | Narrator | Tauri WebView | Smoke test |
| Android | TalkBack | Tauri WebView | Full nav per screen (mobile) |
| Linux (CI) | Orca | Headless | Smoke test |

### 10.3 Keyboard-only testing

Every screen tested with:
- Mouse disconnected / disabled.
- `Tab`/`Shift+Tab` through all interactive elements — verify visible focus + logical order.
- All actions performable via keyboard.
- No keyboard traps (except intentional Modal/Dialog, which have Escape).

### 10.4 High-contrast / reduced-motion testing

- Toggle high-contrast ON; visually verify every screen. Take screenshots; diff against baseline.
- Toggle motion "None"; verify no animation plays.
- Test with OS `prefers-contrast: more` and `prefers-reduced-motion: reduce` — verify auto-detection works.

---

## 11. Visual Design Language — Token System

### 11.1 Token hierarchy

v5 organizes tokens into four layers (CSS custom properties on `:root`):

```
Layer 1: Primitive tokens (raw values, never used directly in components)
  --oklch-accent: 0.7 0.17 255;
  --space-1: 0.25rem;
  --radius-md: 0.375rem;

Layer 2: Semantic tokens (theme-aware aliases — what components use)
  --color-accent: oklch(var(--oklch-accent));
  --color-surface: ...;

Layer 3: Component tokens (optional, for complex components)
  --button-primary-bg: var(--color-accent);
  --card-border: var(--color-border);

Layer 4: Utility classes (the .input, .badge, .elev-1 classes)
```

v4 conflates layers 1 and 2 (the `@theme` block defines semantic tokens with raw oklch values directly). v5 keeps this for backward compatibility but adds layer-3 component tokens where a component needs a derived value that shouldn't be re-computed at every call site.

### 11.2 New semantic tokens (additions to v4)

```css
:root {
  /* Elevation ramp — already exists as --shadow-1..3, formalized here. */
  /* (kept as-is from v3) */

  /* Glassmorphism — for the top bar / floating toolbars */
  --glass-bg: oklch(0.17 0.013 262 / 0.85);   /* dark theme */
  --glass-blur: 18px;
  --glass-saturate: 140%;

  /* Accent glow — for Spotlight panel + primary CTA hover */
  --accent-glow: 0 0 24px oklch(0.7 0.17 255 / 0.3);

  /* Focus ring — formalized (already used in :focus-visible) */
  --focus-ring: 2px solid var(--color-accent);
  --focus-ring-offset: 2px;

  /* Density — spacing multipliers */
  --density-spacing: 1;       /* comfortable (default) */
  /* --density-spacing: 0.75;  compact */
  /* --density-spacing: 1.25;  spacious */
}
```

### 11.3 Spacing scale (formalize Tailwind usage)

Tailwind's spacing scale IS the spacing system. No custom spacing tokens — just consistent application:

| Token | Value | Use |
|-------|-------|-----|
| `gap-1` / `p-1` | 4px | Icon-text gap inside a button |
| `gap-1.5` / `p-1.5` | 6px | Tight element grouping |
| `gap-2` / `p-2` | 8px | Default inline gap |
| `p-3` | 12px | Dense row padding |
| `p-4` | 16px | Card padding (default) |
| `p-6` | 24px | Screen padding (default) |
| `gap-6` | 24px | Section gap |
| `gap-8` | 32px | Major section separation |

### 11.4 Border radius scale

| Token | Value | Use |
|-------|-------|-----|
| `rounded` | 4px | Checkboxes, radio buttons |
| `rounded-md` | 6px | Buttons, inputs, small chips |
| `rounded-lg` | 8px | Cards, modals, panels |
| `rounded-xl` | 12px | Hero cards, Spotlight |
| `rounded-full` | 9999px | Badges, avatars, pills |

---

## 12. Typography

### 12.1 Font stack (unchanged from v3)

The system font stack is the right choice — this app ships in 17 languages including Arabic (RTL), Thai, Hindi, and Japanese. A custom Latin display font would fracture non-Latin scripts. Brand identity carries through color, depth, and motion, not a custom typeface.

```css
font-family:
  system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

Monospace (paths, content-ids, kernel strings):
```css
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
```

### 12.2 Type scale (Tailwind classes → px at 18px root)

| Class | rem | px (at 18px root) | Use |
|-------|-----|--------------------|-----|
| `text-xs` | 0.75 | 13.5 | Captions, timestamps, badge text |
| `text-sm` | 0.875 | 15.75 | Body (secondary), button labels, input text |
| `text-base` | 1.0 | 18 | Body (primary) — the root size |
| `text-lg` | 1.125 | 20.25 | Section titles |
| `text-xl` | 1.25 | 22.5 | Card titles |
| `text-2xl` | 1.5 | 27 | Page titles (`<h1>`) |
| `text-3xl` | 1.875 | 33.75 | Hero titles (Spotlight) |

Font weights:
- `font-normal` (400) — body.
- `font-medium` (500) — button labels, table cells.
- `font-semibold` (600) — section/card titles, tab labels.
- `font-bold` (700) — page titles, emphasis. (Sparingly.)

### 12.3 Numerals

Already set globally: `font-variant-numeric: tabular-nums`. Critical for the many live counters (bytes, MiB/s, ETAs, temps) — proportional digits jitter horizontally every tick.

### 12.4 Line height

- `leading-none` (1.0) — badges, single-line labels.
- `leading-tight` (1.25) — button labels, headings.
- `leading-normal` (1.5) — body text default.
- `leading-relaxed` (1.625) — long-form reading (FAQ, Changelog).

---

## 13. Color System

### 13.1 Four themes (unchanged from v4)

Dark (default), Light, OLED, Rose. All four ship in v5. The theme store (`state/theme.ts`) persists choice and applies before React mounts.

### 13.2 Token inventory (per theme)

Every theme defines these 18 tokens:
- **Surfaces:** `--color-surface`, `--color-surface-2`, `--color-surface-3`
- **Borders:** `--color-border`, `--color-border-strong`
- **Text:** `--color-text`, `--color-muted`
- **Accent:** `--color-accent`, `--color-accent-contrast`, `--color-accent-soft`
- **Semantic:** `--color-good`, `--color-good-soft`, `--color-warn`, `--color-warn-soft`, `--color-bad`, `--color-bad-soft`
- **Platform:** `--color-ps4`, `--color-ps4-soft`, `--color-ps5`, `--color-ps5-soft`
- **Effects:** `--shadow-logo`, `--shadow-1`, `--shadow-2`, `--shadow-3`, `--edge-highlight`, `--atmosphere`, `--overlay-scrim`

### 13.3 Contrast fixes (§6.1) applied to all four themes

The muted/semantic token lightness bumps are applied per-theme (dark, light, OLED, rose) so all four clear 4.5:1.

---

## 14. Elevation & Depth

### 14.1 Elevation ramp (unchanged from v3)

| Class | Shadow | Use |
|-------|--------|-----|
| (none) | flat | Body content, inline elements |
| `.elev-1` | `--shadow-1` + `--edge-highlight` | Cards, panels (resting on surface) |
| `.elev-2` | `--shadow-2` + `--edge-highlight` | Popovers, menus, dropdowns (floating) |
| `.elev-3` | `--shadow-3` + `--edge-highlight` | Modals, dialogs (top layer) |

The `--edge-highlight` (1px inset top border) gives the "machined aluminum edge" effect — subtle on dark, brighter on light.

### 14.2 Z-index scale (formalized)

v4 has ad-hoc z-indexes scattered around (`z-30`, `z-50`, `z-[60]`). v5 formalizes:

| Layer | z-index | What |
|-------|---------|------|
| Base | 0 | Normal content |
| Sticky header | 10 | PageHeader when sticky |
| Drawer/Sheet | 20 | Side panel |
| Popover/Menu | 30 | OverflowMenu, ContextMenu, Tooltip |
| Status bar | 40 | Top status bar |
| Modal | 50 | Modal, ConfirmDialog |
| Modal-on-modal | 60 | Confirm opened from within a Modal |
| Toast | 70 | Toaster (always visible) |
| Skip link | 100 | Focus-skip link |

All defined as CSS custom properties:
```css
:root {
  --z-base: 0;
  --z-sticky: 10;
  --z-drawer: 20;
  --z-popover: 30;
  --z-statusbar: 40;
  --z-modal: 50;
  --z-modal-top: 60;
  --z-toast: 70;
  --z-skip: 100;
}
```

---

## 15. Motion Language

### 15.1 Easing curve

One curve for the whole app: `cubic-bezier(0.2, 0.8, 0.2, 1)` — "fast out, soft landing." Already used by all v4 animations. v5 keeps it.

### 15.2 Duration scale

| Duration | Use |
|----------|-----|
| 100ms | Hover state changes (color) |
| 140ms | Popover/menu entrance (`.anim-rise`) |
| 150ms | Scrim fade (`.anim-scrim`) |
| 180ms | Modal entrance (`.anim-pop`), toast slide |
| 200ms | Route content entrance (`.anim-screen`) |
| 220ms | Drawer slide (`.anim-drawer`), sheet slide (`.anim-sheet`) |
| 300ms | Progress bar width transition, sidebar collapse |
| 2400ms | Status pulse cycle (`.anim-status-pulse`) |
| 2200ms | Skeleton shimmer cycle (`.anim-skeleton`) |

### 15.3 Animation catalog (existing + new)

| Animation | Keyframe | Class | Status |
|-----------|----------|-------|--------|
| Fade in | `ps-fade-in` | `.anim-scrim` | Existing |
| Pop in (modal) | `ps-pop-in` | `.anim-pop` | Existing |
| Rise in (popover) | `ps-rise-in` | `.anim-rise`, `.anim-screen` | Existing |
| Drawer slide | `ps-drawer-in` | `.anim-drawer` | Existing |
| Sheet slide | `ps-sheet-in` | `.anim-sheet` | Existing |
| Shimmer | `ps-shimmer` | `.anim-skeleton` | Existing |
| Soft pulse | `ps-soft-pulse` | `.anim-status-pulse` | Existing |
| **Toast slide** | `ps-toast-in` | `.anim-toast` | **NEW** — `translateY(100%) → 0` + fade, 180ms |
| **Card hover lift** | (transition) | `.hover-lift` | **NEW** — `translateY(-3px)` on hover, 180ms |
| **Spotlight crossfade** | `ps-crossfade` | `.anim-crossfade` | **NEW** — opacity crossfade between game backdrops, 400ms |

### 15.4 Reduced-motion behavior (§7)

Under `data-motion="reduced"`: all durations halved, hover-lift and parallax disabled. Under `data-motion="none"`: all animations and transitions killed.

---

## 16. Iconography

### 16.1 Icon library

`lucide-react` is the icon set (already used throughout v4). Consistent stroke width, SVG-based (scales crisply), tree-shakeable.

### 16.2 Icon size standard (from v5-design §8.3, refined)

| Usage | Size | Stroke |
|-------|------|--------|
| Inline with text (badge, label) | 12px | 2 |
| Button icon (sm button) | 14px | 2 |
| Button icon (md button) | 16px | 2 |
| Button icon (lg button) | 18px | 1.75 |
| IconButton (standalone) | 18-20px | 2 |
| Card header icon | 16px | 1.75 |
| Page header icon | 22px | 1.75 |
| Empty state (compact) | 20px | 1.75 |
| Empty state (hero) | 40px | 1.5 |
| Status bar icon | 11-14px | 2 |
| Modal/Toast close | 16-20px (in 44px IconButton) | 2 |
| Spotlight hero icon | 48px | 1.5 |

### 16.3 Icon a11y

Per §5.5: decorative icons are `aria-hidden`; informative icons get `aria-label` (usually on the wrapping `IconButton` or `role="img"` element).

---

## 17. Density Modes

### 17.1 Three density settings (Settings → Appearance)

| Mode | Row height | Padding | Use case |
|------|-----------|---------|----------|
| Comfortable (default) | 44px min | `p-4` cards, `p-3` rows | Touch users, large monitors at distance |
| Compact | 32px min | `p-3` cards, `p-2` rows | Desktop power-users (Logs, Processes, file lists) |
| Spacious | 52px min | `p-6` cards, `p-4` rows | Accessibility (motor impairment), presentations |

Implementation: `data-density="comfortable|compact|spacious"` on `<html>`. CSS overrides:

```css
:root[data-density="compact"] {
  --row-min: 32px;
  --card-pad: 0.75rem;
}
:root[data-density="spacious"] {
  --row-min: 52px;
  --card-pad: 1.5rem;
}
```

Components reference these tokens instead of hard-coded Tailwind padding. (Migration: the primitive library uses the tokens; existing screens adopt them as they're rewritten.)

**Auto-density:** on first launch, density defaults to "Compact" on desktop (`inputMode() === "mouse"`) and "Comfortable" on touch (`inputMode() === "touch"`). User can override.

### 17.2 Touch vs mouse density

Even without the explicit setting, the touch-target CSS (`@media (pointer: coarse)`) enforces 44px minimums. The density setting is a finer control on top of that.

---

## 18. Glassmorphism & Surfacing

### 18.1 Glass header (top bar)

v5 introduces an optional glassmorphic top bar (status bar + page header when sticky). `backdrop-filter: blur(18px) saturate(140%)` over a semi-transparent surface.

```css
.glass-header {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
```

**Performance caveat:** `backdrop-filter` is GPU-expensive. On low-end Android (mobile doc §15), the glass header degrades to a solid `--color-surface-2` background. Detection: `formFactor() === "phone"` AND `navigator.deviceMemory < 4`.

**Theme note:** the `--glass-bg` is defined per-theme (dark = translucent dark, light = translucent white, OLED = near-black translucent).

### 18.2 Spotlight panel (Games tab hero)

From v5-design §10.1. When the user hovers (desktop) or taps (mobile) a game tile:
- A large backdrop appears: blurred game art, title, quick actions.
- Background: the game's icon/key art, blurred via `filter: blur(40px) brightness(0.4)`.
- Foreground: title + actions in `--color-text`, on the blurred backdrop.
- Accent glow: `box-shadow: var(--accent-glow)` on the primary action button.

On mobile, the Spotlight becomes a full-screen sheet (not a hover panel — there's no hover on touch).

### 18.3 Card hover lift

For interactive cards (Game tiles, Home widgets):
```css
.hover-lift {
  transition: transform 0.18s ease, box-shadow 0.2s ease;
}
.hover-lift:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-2);
}
```
Disabled under `data-motion="reduced"` and `"none"`. Disabled on touch (`@media (hover: hover)` gates it).

---

## 19. Component Primitive Library — Full API

This section is the authoritative spec for every primitive in v5. Migration order in §20.

### 19.1 `Button` (evolve)

```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";        // NEW: lg (52px). Default: md (was sm).
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  block?: boolean;                    // NEW: full-width (w-full)
  children?: React.ReactNode;
}
```

Changes from v4:
- **Default size → `md`** (44px). The most common a11y complaint (touch targets too small) is fixed by default.
- Add `lg` size (52px) for primary CTAs on Home/hero cards.
- Add `block` prop.
- Internal: sizing now references density tokens (§17) so compact mode shrinks appropriately.

### 19.2 `IconButton` (NEW)

```tsx
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;              // REQUIRED — no label, no mount
  variant?: "ghost" | "secondary" | "danger";
  size?: "sm" | "md";                // sm=36px, md=44px (default)
  active?: boolean;                  // visual "pressed" state (e.g. pinned)
  children: React.ReactNode;         // the icon
}
```

- Always square, icon centered.
- `aria-label` is required (runtime check in dev builds).
- Replaces 100+ raw `<button>` with just an icon.

### 19.3 `Input` (NEW)

```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;                     // renders <label> above
  labelHint?: string;                 // small text right of label ("optional")
  error?: string;                     // red text below + aria-invalid
  hint?: string;                      // muted text below ("e.g. 192.168.1.100")
  leftIcon?: React.ReactNode;         // icon inside left padding (e.g. search icon)
  rightSlot?: React.ReactNode;        // button inside right (e.g. "Test" button)
  block?: boolean;                    // full-width (default true)
}
```

- Renders `<label>` + `<input>` pair with proper `htmlFor`/`id`.
- `error` sets `aria-invalid="true"` and `aria-describedby` → error text id.
- `hint`/`error` have unique ids for ARIA association.
- Uses the `.input` class styling (already in index.css) for consistency.

### 19.4 `Select` (NEW)

```tsx
interface SelectOption {
  value: string;
  label: string;
}
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  block?: boolean;
}
```

- Wraps native `<select>` (best a11y, best mobile UX — native picker).
- Styled via a `.select` class (sibling to `.input`).
- Same label/error/hint pattern as Input.

### 19.5 `Textarea` (NEW)

```tsx
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  block?: boolean;
}
```

### 19.6 `Checkbox` (NEW)

```tsx
interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;            // the visible label
  hint?: string;                      // muted text below label
  error?: string;
  disabled?: boolean;
  indeterminate?: boolean;            // NEW: tri-state (for "select all")
}
```

- Renders native `<input type="checkbox">` + `<label>` with association.
- Visual: 20px box (24px on touch), accent-color check.
- `indeterminate` sets the DOM property (only via ref — React doesn't support it declaratively).

### 19.7 `Toggle` (Switch) (NEW)

```tsx
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;            // rendered alongside (label is also clicked)
  hint?: string;
  disabled?: boolean;
}
```

- Renders a `<button role="switch" aria-checked={checked}>` (NOT a checkbox — switches have different semantics).
- Visual: 52×28px track + thumb; 44px hit area.
- Replaces Settings' misuse of checkboxes for binary settings.

### 19.8 `RadioGroup` (NEW)

```tsx
interface RadioOption {
  value: string;
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}
interface RadioGroupProps {
  name: string;                       // REQUIRED — radio group identity
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  label?: string;                     // group label (becomes <fieldset><legend>)
  orientation?: "vertical" | "horizontal";
}
```

- Renders `<fieldset><legend>{label}</legend>` + native `<input type="radio">` per option.
- Uses fieldset/legend for grouping semantics.

### 19.9 `Tabs` (generalize from TabbedShell)

```tsx
interface Tab {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: string | number;            // count badge
  disabled?: boolean;
}
interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  variant?: "underline" | "pills" | "segmented";  // visual style
  size?: "sm" | "md";
  ariaLabel?: string;                 // tablist label
}
```

- Three visual variants: underline (current TabbedShell style), pills (Game Hub), segmented (File Browser view modes).
- **Responsive variant note (R19, loops 81-90):** Game Hub uses **pills on desktop/lg+** and **scrollable underline on mobile xs/sm/md** (the 8-tab set doesn't fit comfortably as pills on a phone, so the same `Tabs` instance switches `variant` via `useResponsiveTier()` — pills above the `md` breakpoint, underline below). This reconciles the earlier pills-vs-underline contradiction between this section and `v5-mobile-design.md` §5.3.
- Full WAI-ARIA Tabs pattern (from TabbedShell).
- `TabbedShell` becomes a thin wrapper that syncs `value` with `useSearchParams`.

### 19.10 `Badge` (NEW)

```tsx
interface BadgeProps {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad" | "ps4" | "ps5";
  size?: "sm" | "md";
  variant?: "soft" | "solid" | "outline";
  dot?: boolean;                      // leading status dot
  icon?: LucideIcon;
}
```

- Replaces 50+ inline `<span className="badge badge-success">` patterns.
- `dot` renders a leading colored dot (with `aria-hidden` — decorative; the tone color pairs with text).

### 19.11 `Card` (evolve)

```tsx
interface CardProps {
  title?: string;
  icon?: LucideIcon;
  right?: React.ReactNode;            // header right slot
  actions?: React.ReactNode;          // NEW: footer actions row
  padded?: boolean;
  accent?: boolean;
  interactive?: boolean;              // NEW: hover-lift, onClick → button
  onClick?: () => void;
  children: React.ReactNode;
}
```

- `interactive` adds `.hover-lift` and renders the card as a `<button>` (if onClick) or `<a>` (if href).
- `actions` renders a footer row with top border (for action buttons).

### 19.12 `Tooltip` (NEW)

```tsx
interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;       // the trigger — must be focusable
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;                     // default 500ms
}
```

- Uses `aria-describedby` → tooltip id (NOT `aria-label` — tooltip text is supplementary, not the element's name).
- Appears on hover AND focus-visible (keyboard users).
- Auto-positions (flips if no room).
- `Esc` dismisses.
- **Replaces** all `title=""` attributes (native tooltips — ugly, inaccessible, can't be themed, no delay control).

### 19.13 `Table` / `DataGrid` (NEW)

```tsx
interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: "left" | "right" | "center";
}
interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (sort: { key: string; dir: "asc" | "desc" }) => void;
  empty?: React.ReactNode;            // shown when rows is empty
  dense?: boolean;
  virtualize?: boolean;               // for > 100 rows
  ariaLabel?: string;
}
```

- Renders semantic `<table>` with `<thead>`, `<tbody>`, `<th scope>`, `<td>`.
- Sortable columns get `aria-sort`.
- `virtualize` opts into react-window for large lists.
- Replaces 15+ ad-hoc tables.

### 19.14 `Drawer` (NEW, extract from AppShell)

```tsx
interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;                     // default "85vw" mobile, "320px" desktop
}
```

- `role="dialog"`, `aria-modal="true"`, focus trap, Escape, scrim.
- Slides from `side`.
- Replaces the hand-rolled sidebar drawer in AppShell.

### 19.15 `Sheet` (NEW — bottom sheet)

```tsx
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  // Renders only on touch (mobile doc §4); on desktop, renders as a Modal.
  forceBottom?: boolean;
}
```

- Mobile: slides from bottom (`.anim-sheet`).
- Desktop: falls back to centered Modal (unless `forceBottom`).
- `role="dialog"`, focus trap, etc.
- Drag-to-dismiss (grab the handle, swipe down) — disabled under reduced motion.

### 19.16 `ContextMenu` (NEW)

```tsx
interface ContextMenuProps {
  items: OverflowMenuItem[];          // reuse OverflowMenu's item type
  children: React.ReactElement;       // the trigger element
}
```

- Desktop: right-click (`onContextMenu`) opens at cursor.
- Mobile: long-press (500ms) opens at touch point.
- Same ARIA Menu pattern as OverflowMenu.
- Closes on outside-click, Escape, item-select.

### 19.17 `Toaster` / `useToast` (NEW)

```tsx
interface ToastOptions {
  message: string;
  tone?: "info" | "success" | "warn" | "critical";
  duration?: number;                  // default: info 4s, success 3s, warn 6s, critical sticky
  action?: { label: string; onClick: () => void };
}
// useToast() returns:
interface ToastApi {
  toast: (opts: ToastOptions) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}
```

- One `<Toaster />` at app root (in AppShell).
- Toasts stack bottom-right (desktop) / top (mobile, below status bar).
- Each toast: `role="status"` (polite) for info/success, `role="alert"` (assertive) for warn.
- If `action` is present, the toast is focusable and the action button is in the tab order.
- Respect motion settings (slide animation under full; instant under reduced/none).
- **NOT for errors** (those are inline ErrorCard). Warn is for "action needed soon" (e.g. "PS5 disk 95% full"). Critical task alerts (cross-cutting §6.5) override to `role="alert"`.
- **`tone="critical"` carve-out (R21, loops 81-90):** The **only** error-class tone permitted in a toast. Used exclusively for Task System §7.4 critical alerts (e.g. thermal trip, power-off imminent) that must surface immediately regardless of current screen. Maps to the `bad` color token, `role="alert"`, and is **sticky** (no auto-dismiss) until the underlying alert clears or the user dismisses. All other errors remain inline. This reconciles the "no errors in toast" rule with the critical-alert requirement in cross-cutting §6.5 and home-console §18.3.

### 19.18 `Spinner` (NEW, formalize)

```tsx
// Just a styled Loader2 — but centralized so size/color are consistent.
function Spinner({ size = 16, className }: { size?: number; className?: string });
```

- Used by Button's `loading` state (already) and anywhere inline loading is needed.
- `aria-hidden` (it's decorative; the surrounding `aria-busy="true"` conveys loading).

### 19.19 `SkipNav` (NEW)

```tsx
function SkipNav() {
  return <a href="#main" className="skip-link">Skip to main content</a>;
}
```

- First focusable element in the DOM.
- Visually hidden until focused (§3.3).

### 19.20 `LiveRegion` (NEW)

```tsx
function LiveRegion() {
  const message = useLiveRegionStore((s) => s.message);
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
```

- Mounted once at app root.
- `.sr-only` is the visually-hidden class (§19.24).

### 19.21 `Spotlight` (NEW — Games tab hero)

```tsx
interface SpotlightAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  disabledReason?: string;            // → tooltip when disabled
}
interface SpotlightProps {
  game: { title: string; iconUrl?: string };
  actions: SpotlightAction[];
  onClose: () => void;
}
```

- Full-screen on mobile, large panel on desktop.
- Blurred backdrop from `game.iconUrl`.
- Actions rendered as primary/secondary buttons.
- `aria-label="{game.title} — quick actions"`.
- **Mobile trigger model (R16, loops 81-90):** Two distinct entry paths, both valid:
  - **Tap** on a game tile → full-screen `Spotlight` (this component, as specified above).
  - **Long-press** on a game tile → transient **peek `Sheet`** (bottom sheet, §19.16) showing the top 2-3 actions; tapping "More" opens the full `Spotlight`.
  - This reconciles the apparent contradiction between this section ("full-screen on mobile") and `v5-mobile-design.md` §5.2 ("peek sheet"). They describe different triggers; both are part of the canonical interaction model.

### 19.22 `SegmentedControl` (NEW)

```tsx
interface Segment {
  value: string;
  label: string;
  icon?: LucideIcon;
}
interface SegmentedControlProps {
  segments: Segment[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}
```

- `role="radiogroup"` + `role="radio"` (WAI-ARIA Radiogroup pattern — arrow keys move, not Tab).
- Visual: pill-shaped container with the active segment filled.
- For File Browser view modes, Activity view toggle, Media kind toggle.

### 19.23 `Breadcrumb` (NEW)

```tsx
interface Crumb {
  label: string;
  onClick?: () => void;               // no onClick = current page (not a link)
}
interface BreadcrumbProps {
  items: Crumb[];
}
```

- `<nav aria-label="Breadcrumb"><ol>...` with `<li>` per crumb.
- Separators are `/` (aria-hidden).
- Last item has `aria-current="page"`.
- For File Browser path, SMB path.

### 19.24 `Callout` (consolidate ErrorCard/SuccessCard/WarningCard)

```tsx
interface CalloutProps {
  tone: "error" | "warn" | "success" | "info";
  title: string;
  children?: React.ReactNode;         // body
  action?: React.ReactNode;
  onDismiss?: () => void;
}
```

- `error` → `role="alert"`, `aria-live="assertive"`.
- `warn`/`success`/`info` → `role="status"`, `aria-live="polite"`.
- Tone determines color (bad/warn/good/accent) and icon (✗/⚠/✓/ⓘ).
- **Replaces** `ErrorCard`, `SuccessCard`, `WarningCard` (which become deprecated aliases).

### 19.25 `ProgressBar` (evolve)

```tsx
interface ProgressBarProps {
  value?: number | null;               // 0..1, omit for indeterminate
  tone?: "accent" | "good" | "warn" | "bad";
  size?: "sm" | "md";
  label?: string;                      // REQUIRED for a11y — announces what's progressing
  paused?: boolean;                    // NEW: visual freeze + "paused" to SR
  className?: string;
}
```

- `label` becomes `aria-label` (was missing — indeterminate bars were unnamed).
- `paused` shows a striped overlay + announces "paused".

### 19.26 `Modal` (evolve)

```tsx
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";   // NEW: full
  variant?: "center" | "sheet";                  // NEW: sheet (mobile bottom-sheet)
  closeOnScrim?: boolean;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
}
```

- `variant="sheet"` renders as bottom-sheet on mobile (via Sheet), centered on desktop.
- `size="full"` for fullscreen modals (Command Palette on mobile, image viewer).
- **`ConfirmDialog` fate (R26, loops 81-90):** `ConfirmDialog` is **NOT** a separate §19 primitive — it remains a thin wrapper over `Modal` (with `role="alertdialog"`) exposing the existing `useConfirm` / `useAlert` / `usePrompt` hooks. The only v5 change is the prompt-input fix in §20 (replace the raw `.input` class with the new `Input` primitive). No API change. Mobile assigns it the `confirm` haptic (cross-cutting §6.6) on the confirm button.

### 19.27 `Menu` (evolve OverflowMenu → add arrow-key nav)

OverflowMenu gains:
- Arrow-key navigation within the open menu (Up/Down/Home/End, cyclic).
- `aria-activedescendant` pattern (the menu has focus; active item is pointed to).

```tsx
// Existing OverflowMenu API unchanged; internal implementation upgraded.
```

### 19.28 `.sr-only` utility class (NEW)

```css
.sr-only {
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

The standard visually-hidden pattern. Used by LiveRegion, SkipNav (until focused), and anywhere text is for screen readers only. Added to `index.css`.

### 19.29 `EmptyState` (evolve — R15, loops 81-90)

`EmptyState` is named as a consumed primitive in cross-cutting §6.4, `v5-design.md` §8.1, the Game Hub, and §1 of this doc — but had no §19 entry. This slot closes that gap.

```tsx
interface EmptyStateProps {
  title: string;                       // e.g. "No saves backed up"
  body?: React.ReactNode;              // explanatory line, muted
  action?: { label: string; onClick: () => void; primary?: boolean };
  hero?: React.ReactNode;             // optional icon/illustration (≤ 96px)
  role?: "status" | "alert";          // default "status" (polite)
}
```

- Vertically and horizontally centered in its container.
- **Height: `min-height: 55vh`** (the v3 docstring value). The 72vh in the current code is the bug — documented in `v5-design.md` §8.2; this section is canonical. 55vh keeps the empty state from pushing the page footer off-screen on shorter viewports while still feeling substantial.
- `title` is an `<h2>` (or `<h3>` when nested in a panel — caller decides via `as` prop if needed); `body` is muted text below.
- `action` renders as a `Button` (primary or secondary). Single action only — multi-action empty states use a small `Menu`.
- `hero` is decorative (`alt=""` / `aria-hidden`); the `title`+`body` carry the meaning.
- `role="status"` by default so screen readers announce "No saves backed up" on focus; switch to `role="alert"` only for error-driven empties (e.g. "Search returned no results because the PS5 is offline").
- Touch target: the `action` button follows Button's 44×44 minimum.

---

## 20. Migration Plan

### 20.1 Phase order

The primitives are built bottom-up (tokens → atoms → molecules → organisms):

**Phase 1 — Foundation (tokens + utilities)**
1. Add `.sr-only` class to index.css.
2. Add new tokens (`--glass-bg`, `--accent-glow`, `--z-*`, density tokens).
3. Fix contrast: bump `--color-muted`/semantic text lightness in all 4 themes.
4. Add `data-motion`, `data-density`, `data-contrast`, `data-dyslexia` attribute handling.

**Phase 2 — Atoms (form primitives + icon button)**
5. `Spinner` (trivial — just export a styled Loader2).
6. `IconButton`.
7. `Input`.
8. `Select`.
9. `Textarea`.
10. `Checkbox` (with indeterminate).
11. `Toggle`.
12. `RadioGroup`.

**Phase 3 — Molecules (display + feedback)**
13. `Badge`.
14. `Callout` (consolidate ErrorCard family; keep old names as aliases).
15. `Tooltip`.
16. `SegmentedControl`.
17. `Breadcrumb`.
18. Evolve `ProgressBar` (add `label`, `paused`).
19. Evolve `Card` (add `interactive`, `actions`).
20. Evolve `Button` (default to `md`, add `lg`, `block`).

**Phase 4 — Organisms (overlays + navigation)**
21. `Drawer` (extract from AppShell).
22. `Sheet`.
23. Evolve `Modal` (add `variant="sheet"`, `size="full"`).
24. Evolve `OverflowMenu` (arrow-key nav).
25. `ContextMenu`.
26. `Toaster` + `useToast`.
27. Generalize `Tabs` (from TabbedShell; three variants).

**Phase 5 — Domain components**
28. `Table` / `DataGrid`.
29. `Spotlight`.
30. `SkipNav` + `LiveRegion`.

**Phase 6 — Fixes (bug fixes that don't need new components)**
31. Fix `ErrorBoundary` broken tokens (`--color-bg` → `--color-surface`, `--color-surface-hover` → `--color-surface-3`, `text-white` → `--color-accent-contrast`).
32. Add `alt` prop to `GameIcon`.
33. Add `aria-busy` guidance to screens using `Skeleton`.
34. Add `aria-label` to `ProgressBar` usages.
35. Fix `ConfirmDialog` prompt input to use `.input` class.

**Phase 7 — Screen migration (the long tail)**
36. Migrate Settings screen first (it uses every form primitive — good dogfood).
37. Migrate other screens one by one, replacing raw `<input>`/`<select>`/`<textarea>`/`<button>` with primitives.
38. Replace `title=""` attributes with `<Tooltip>`.
39. Replace ad-hoc `<span className="badge">` with `<Badge>`.

### 20.2 Migration rules

- **Never break the barrel export.** `components/index.ts` keeps re-exporting everything; new primitives are added; old names (`ErrorCard` etc.) remain as aliases during migration and are removed only after all call sites updated.
- **One primitive per PR** (for review tractability). Phase 6 fixes can be bundled.
- **Add tests** (`@axe-core/playwright` + `eslint-plugin-jsx-a11y`) in Phase 1, so every subsequent PR is gated on a11y.
- **No "big bang" screen rewrite.** Each screen migration is its own PR. Settings first (dogfood), then highest-traffic screens (Home, Games, Files), then the rest.

### 20.3 Deprecation path

- `ErrorCard`, `SuccessCard`, `WarningCard` → deprecated in v5.0, removed in v5.2. Re-exported as `Callout` with `tone` for the transition.
- `TabbedShell` → stays (it's the URL-synced Tabs variant); `Tabs` is the general primitive.
- `OverflowMenu` → stays (just upgraded internally).
- All other existing primitives stay.

---

## 21. Accessibility Settings Panel

Settings → Accessibility (new section in v5 Console → ... no, Settings is its own drawer entry per cross-cutting §3). The Accessibility section contains:

| Setting | Control | Default | Effect |
|---------|---------|---------|--------|
| **Motion** | SegmentedControl: Full / Reduced / None | Auto (follows OS) | §7 |
| **High contrast** | Toggle | Off (auto-on if OS `prefers-contrast: more`) | §6.3 |
| **Color blind palette** | Select: Default / Deuteranopia / Protanopia / Tritanopia | Default | §6.4 |
| **Dyslexia-friendly font** | Toggle | Off | §8.2 |
| **Text size** | Range slider (80%-150%) | 100% | §8.1 (existing `uiScale`) |
| **Density** | SegmentedControl: Comfortable / Compact / Spacious | Auto (touch=Comfortable, mouse=Compact) | §17 |
| **Haptic feedback** | Toggle | On (mobile only) | §6.6 cross-cutting |
| **Screen reader hints** | Toggle | Off | §21.1 below |

### 21.1 Screen reader hints

When ON, the app renders additional `aria-label`s that are verbose for screen reader users but would be redundant for sighted users. E.g. a "Refresh" button normally has no aria-label (the visible text is enough); with hints ON, it becomes `aria-label="Refresh the list of games"`. This is opt-in because verbose labels can slow down power-screen-reader-users who prefer brevity.

Detection: `navigator.userAgentData` hints (Tauri may expose whether a screen reader is running — but this is unreliable across platforms, so it's a manual toggle, not auto).

### 21.2 Settings persistence

All accessibility settings persist via the existing `userConfig.ts` mechanism (localStorage + Tauri store). They apply before React mounts (same pattern as theme + uiScale) to avoid a flash of the wrong mode.

---

## 22. Implementation Phasing

This work is **v5.0 Phase 0** — it must land BEFORE the screen rewrites (Home, Games, Files, Console, Tasks), because those screens consume these primitives. Cross-cutting **§12** *(R23, loops 81-90: was "§10", corrected — §10 is "Concurrency")* (the canonical phased plan) places this in **Phase 5.0** (weeks 1-3), alongside the CSS token fixes.

### 22.1 Estimated effort

| Phase | Effort | Description |
|-------|--------|-------------|
| Phase 1 (tokens + utilities) | 2 days | CSS + token fixes, `.sr-only`, data attributes |
| Phase 2 (atoms) | 4 days | 8 form primitives |
| Phase 3 (molecules) | 3 days | 8 display/feedback primitives |
| Phase 4 (organisms) | 4 days | 7 overlay/navigation primitives |
| Phase 5 (domain) | 3 days | Table, Spotlight, SkipNav, LiveRegion |
| Phase 6 (fixes) | 1 day | ErrorBoundary tokens, GameIcon alt, etc. |
| Phase 7 (Settings migration) | 2 days | Settings as dogfood + a11y Settings panel |
| **Total** | **~19 days (4 weeks)** | |

Phase 7 (remaining screen migrations) continues in parallel with the screen rewrites (**Phase 5.1** — was "5.0.1-5.0.4", corrected R23) — each rewritten screen uses primitives by default; each non-rewritten screen is migrated opportunistically.

### 22.2 Dependencies

- `react-window` (or equivalent) — new dep for virtualized Table + virtualized lists (mobile doc §15.3 already calls for this).
- `@axe-core/playwright` — dev dep for E2E a11y tests.
- `eslint-plugin-jsx-a11y` — dev dep for lint.
- No new runtime deps for the primitives themselves (pure React + Tailwind + existing lucide-react).

### 22.3 Acceptance criteria

The primitive library is "done" when:
1. **Zero** raw `<input>`, `<select>`, `<textarea>` in `client/src/screens/` (all migrated to primitives).
2. **Zero** `title=""` attributes on interactive elements (all migrated to `<Tooltip>` or removed).
3. **Zero** a11y lint errors (`eslint-plugin-jsx-a11y`).
4. **Zero** axe-core violations on any screen (E2E tests green).
5. All four themes pass contrast audit (≥ 4.5:1 for text, ≥ 3:1 for non-text).
6. Full keyboard navigation verified on all screens (manual test matrix).
7. VoiceOver/TalkBack smoke test passes on Home, Games, Files, Console, Tasks.
8. `ErrorBoundary` tokens fixed; no `--color-bg` / `--color-surface-hover` / `text-white` anywhere in the codebase.

---

*This document is the canonical spec for v5 accessibility, visual design language, and component primitives. It supersedes §8, §10, and Appendix C of `v5-design.md`. All other v5 design docs consume these primitives; conflicts are resolved in favor of this document for component API and a11y behavior, and in favor of `v5-cross-cutting-concerns.md` for navigation/route/error-handling integration.*
