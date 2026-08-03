# ps5upload v5.0 — Mobile / Android Design (Revised)

> **Scope.** This document consolidates every mobile-specific decision
> spread across the four revised design docs (`game-hub-revised-
> design.md`, `v5-file-browser-redesign.md`, `v5-task-system.md`,
> `v5-home-console-redesign.md`) and the cross-cutting doc
> (`v5-cross-cutting-concerns.md`), adds the platform-layer concerns
> those docs hand-wave (Tauri Mobile limitations, Android WebView
> quirks, scoped storage, keep-awake, background execution, install/update
> flow, hardware back button, intents, sharing), and defines the
> responsive breakpoint strategy that lets one React tree serve phone,
> tablet, and desktop.
>
> **Status:** PLANNING — no code written yet.
>
> **Grounded in:**
> - **Platform detection:** `client/src/lib/platform.ts` (`isAndroid`,
>   `isIOS`, `isMobile` via UA + maxTouchPoints)
> - **Keep-awake:** `client/src/state/keepAwake.ts` + `client/src/lib/
>   androidScreenWake.ts` (WebView Wake Lock API; Rust inhibitor no-op
>   on Android)
> - **File pickers:** `client/src/state/localPicker.ts`, `client/src/
>   lib/pickPath.ts` (Android branches to in-app Scoped Storage browser)
> - **AppShell mobile gates:** `client/src/layout/AppShell.tsx`
>   (`usePkgAutoRoute` skips on Android; `AndroidStorageAccessBanner`)
> - **Visibility / backgrounding:** `client/src/lib/visibility.ts`,
>   `client/src/state/notifications.ts` (OS notification mirroring)
> - **Existing mobile patterns in revised docs:**
>   File Browser §13 (full mobile section), §11.3 (clipboard metaphor);
>   Home/Console §19 (Thermal/Shell/Processes/Profile/Power mobile);
>   Game Hub §4.1 (swipeable tab strip), §8.3 (saves mobile), §7.3
>   (cheat safe-launch), §11 (uninstall long-press); v5-design §9
>   (mobile patterns + WebView optimizations); cross-cutting §1.5, §6.5
>   (haptics), §1.4 (status bar mobile collapse)

---

## Table of Contents

0. [Mobile Gap Register](#0-mobile-gap-register)
1. [Platform & Form-Factor Detection](#1-platform--form-factor-detection)
2. [Responsive Breakpoint Strategy](#2-responsive-breakpoint-strategy)
3. [Navigation: Bottom Nav, Drawer, Back Button](#3-navigation-bottom-nav-drawer-back-button)
4. [Touch Target & Gesture Library](#4-touch-target--gesture-library)
5. [Per-Tab Mobile Patterns](#5-per-tab-mobile-patterns)
6. [Android WebView Hardening](#6-android-webview-hardening)
7. [Tauri Mobile Limitations](#7-tauri-mobile-limitations)
8. [Scoped Storage & File Access](#8-scoped-storage--file-access)
9. [Keep-Awake, Backgrounding & Foreground Service](#9-keep-awake-backgrounding--foreground-service)
10. [Install / Update / First-Launch Flow](#10-install--update--first-launch-flow)
11. [Intents, Sharing & Deep-Links](#11-intents-sharing--deep-links)
12. [Hardware Back Button](#12-hardware-back-button)
13. [Notifications & OS Integration](#13-notifications--os-integration)
14. [Accessibility on Mobile](#14-accessibility-on-mobile)
15. [Performance & Memory Budget](#15-performance--memory-budget)
16. [Tablet / Large-Screen Mobile](#16-tablet--large-screen-mobile)
17. [Phased Implementation](#17-phased-implementation)
18. [Appendix A — Mobile Gap Register (resolved)](#appendix-a--mobile-gap-register-resolved)
19. [Appendix B — Gesture cheat-sheet](#appendix-b--gesture-cheat-sheet)
20. [Appendix C — Platform capability matrix]((#appendix-c--platform-capability-matrix)

---

## 0. Mobile Gap Register

*(R25, loops 81-90: removed the unsourced "12 concerns / resolve 8"
claim — the M1-M20 table below is self-sufficient.)*

| # | Severity | Gap | Resolution |
|---|----------|-----|------------|
| M1 | **CRITICAL** | No formal responsive breakpoint strategy — docs say "mobile < 768px" informally | §2 |
| M2 | **CRITICAL** | Hardware back button behavior undefined (Android) | §12 |
| M3 | **CRITICAL** | Tauri Mobile background execution limits undocumented (schedules die when backgrounded) | §7, §9 |
| M4 | **CRITICAL** | No install/update/first-launch flow for the Android APK | §10 |
| M5 | **MAJOR** | Android Scoped Storage handling scattered (banner in AppShell, picker in localPicker, paths in pickPath) | §8 |
| M6 | **MAJOR** | No sharing/intent inbound flow (receive a .pkg from another app) | §11 |
| M7 | **MAJOR** | OS notification mirroring behavior under Doze / App Standby unspecified | §13 |
| M8 | **MAJOR** | Keep-awake vs battery: no auto-disable policy on transfers longer than X | §9.3 |
| M9 | **MAJOR** | Tablet/large-screen mobile undefined (foldables, iPad) | §16 |
| M10 | **MAJOR** | Haptic vocabulary scattered (cross-cutting §6.5 + Home/Console §19.6) | §4.4 |
| M11 | **MINOR** | Pull-to-refresh vs overscroll-contain conflict on lists | §6.3 |
| M12 | **MINOR** | Soft keyboard "Done" / "Enter" semantics per Input | §4.5 |
| M13 | **MINOR** | Picture-in-picture for Remote Play | §13.5 |
| M14 | **MINOR** | Orientation lock per screen (fan curve landscape?) | §4.6 |
| M15 | **MINOR** | RTL mobile drawer side | cross-cutting §3.3 (resolved) |
| M16 | **MINOR** | Safe-area handling for notch / hole-punch / dynamic island | §6.2 |
| M17 | **MINOR** | Font size zoom (Android WebView text-size-adjust) | §6.4 |
| M18 | **MINOR** | Splash screen | §10.5 |
| M19 | **MINOR** | Status bar color (Android system status bar, not the app's) | §6.5 |
| M20 | **MINOR** | Vibration API absent on iOS (Tauri iOS not shipped yet but planned) | §4.4 |

---

## 1. Platform & Form-Factor Detection

### 1.1 Detection primitives (extend `platform.ts`)

The existing `client/src/lib/platform.ts` exports `isAndroid()`,
`isIOS()`, `isMobile()`. v5 adds form-factor detection that does NOT
conflate "touch" with "phone" — a touch laptop is not a phone:

```ts
// platform.ts (v5 extension)
type FormFactor = "phone" | "tablet" | "desktop";
type InputMode = "touch" | "mouse" | "hybrid";

function viewportMin(): number {
  if (typeof window === "undefined") return 1024;
  return Math.min(window.innerWidth, window.innerHeight);
}

export function formFactor(): FormFactor {
  if (!isMobile()) return "desktop";
  // iPad reports >= 768 in portrait; iPhones report <= 430.
  // 600px is the Android/Nexus 7 small-tablet boundary.
  return viewportMin() >= 600 ? "tablet" : "phone";
}

export function inputMode(): InputMode {
  if (typeof window === "undefined") return "mouse";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;
  const hover = window.matchMedia("(hover: hover)").matches;
  if (coarse && fine) return "hybrid";       // Surface, iPad Pro w/ keyboard
  if (coarse && !hover) return "touch";       // phones, pure tablets
  return "mouse";
}

export function responsiveTier(): "xs" | "sm" | "md" | "lg" | "xl" {
  // see §2 breakpoints
  const w = typeof window === "undefined" ? 1280 : window.innerWidth;
  if (w < 480) return "xs";
  if (w < 768) return "sm";
  if (w < 1024) return "md";
  if (w < 1536) return "lg";
  return "xl";
}
```

### 1.2 What each API gates

| API | Used to gate |
|-----|--------------|
| `isAndroid()` | Scoped storage picker, drag-drop skip, hardware back button, intent receiving, APK install prompt, vibration, keep-awake wake-lock vs Rust inhibitor |
| `isIOS()` | (future) iOS-specific picker, no Vibration API, no background service |
| `isMobile()` | Bottom nav vs left rail, full-screen modals vs centered, touch targets, haptic vocabulary |
| `formFactor()` | Tablet dual-pane affordances, foldable snap |
| `inputMode()` | Touch target padding, long-press menus vs right-click, drag handles |
| `responsiveTier()` | Layout breakpoints (§2) |

### 1.3 Why we don't trust UA alone

iPadOS 13+ reports as Macintosh in UA. The existing `isIOS()` already
handles this via `maxTouchPoints > 1`. v5 keeps that disambiguation.
For Android, `/android/i` is reliable; we also key off `(pointer:
coarse)` and viewport to detect Android tablets (which the user may
hold in landscape with a keyboard).

---

## 2. Responsive Breakpoint Strategy

### 2.1 Breakpoints (Tailwind-aligned, augmented for mobile)

| Tier | Width | Layout | Status bar | Modal | Drawer | Files pane |
|------|-------|--------|------------|-------|--------|------------|
| **xs** | < 480 px | bottom nav, 1-col content | header chips only | full-screen sheet | 100 vw | single pane |
| **sm** | 480–767 px | bottom nav, 1-col content | header chips only | full-screen sheet | 85 vw | single pane |
| **md** | 768–1023 px | bottom nav, 2-col content (tablets) | condensed strip | large sheet | 320 px | single + context rail |
| **lg** | 1024–1535 px | left rail, normal | full strip | centered | 320 px | dual pane |
| **xl** | ≥ 1536 px | left rail, wide content | full strip | centered | 320 px | dual pane + preview |

Tier boundaries are enforced via Tailwind classes (`sm:`, `md:`, `lg:`,
`xl:`) plus a `useResponsiveTier()` hook for JS branches. The hook
subscribes to `matchMedia` and re-renders on tier change.

### 2.2 Why 480 / 768 / 1024 / 1536 (not custom)

- 480 px = large phone landscape (iPhone Pro Max landscape = 844, but
  content width with safe areas ≈ 470). Below 480, full-screen sheets
  are mandatory; above, modals can be "large sheet" (90 vw).
- 768 px = iPad portrait. The transition from 1-col to 2-col content.
- 1024 px = iPad landscape, small laptop. The transition from bottom
  nav to left rail (enough horizontal space for a 56 px rail + 768+
  content).
- 1536 px = typical desktop. Wide content max-width kicks in.

### 2.3 Per-tier behavior matrix

| Behavior | xs | sm | md | lg | xl |
|----------|----|----|----|----|-----|
| Bottom nav visible | ✓ | ✓ | ✓ | — | — |
| Left rail visible | — | — | — | ✓ | ✓ |
| Header chips (status) | ✓ | ✓ | ✓ | — | — |
| Bottom status strip | — | — | — | ✓ | ✓ |
| Modals full-screen | ✓ | ✓ | — | — | — |
| Modals bottom-sheet | ✓ | ✓ | ✓ | optional | optional |
| Drawer 100 vw | ✓ | — | — | — | — |
| Files dual pane | — | — | — | ✓ | ✓ |
| Game Hub swipeable tabs | ✓ | ✓ | ✓ | — | — |
| Console section swipe strip | ✓ | ✓ | ✓ | — | — |
| Tasks single-column | ✓ | ✓ | — | — | — |
| Command palette full-screen | ✓ | ✓ | ✓ | — | — |
| Thermal graph horizontal scroll | ✓ | ✓ | ✓ | — | — |
| Touch target padding (≥ 44 px) | ✓ | ✓ | ✓ | hover-only | hover-only |

### 2.4 Foldable / multi-window

For Samsung DeX and foldables ( Galaxy Fold inner display = 768 px ),
the `md` tier engages with left rail and 2-col content. Window split
(App multi-window) reads `visualViewport.width` rather than
`window.innerWidth` for accurate sizing. The `useResponsiveTier()` hook
listens to both `resize` and `visualViewport.resize`.

---

## 3. Navigation: Bottom Nav, Drawer, Back Button

### 3.1 Bottom nav (xs / sm / md)

Per cross-cutting §1.5. Five tabs, 56 px tall + `env(safe-area-inset-
bottom)` padding. Each tab is ≥ 44 × 44 px (the nav is wider, but the
*tappable center* meets the guideline). Active tab: accent color +
filled icon + label.

```
┌────┬────┬────┬────┬────┐
│ 🏠 │ 🎮 │ 📁 │ 🖥️ │ 📋 │
│Home│Game│File│Con │Task│
└────┴────┴────┴────┴────┘
```

- Haptic `tap` event on tab change (§4.4).
- Long-press a tab → ⌘K opens pre-filtered to that tab's actions
  (power-user shortcut).
- The nav hides during fullscreen media playback (videos in Game Hub
  → Media) and during Remote Play PiP (§13.5).

### 3.2 Top bar (all tiers)

44 px + `env(safe-area-inset-top)`. Left: hamburger (≡) for the
Drawer. Center: console selector (compact: just the dot + name; tap
opens full roster picker as a sheet). Right: ⌘K icon (or a magnifying
glass on xs/sm), notification bell, settings cog.

On xs/sm, the global status bar is **collapsed into the top bar** as
3 chips: connection dot, temp, alert bell. Tap any chip → Console
relevant section. (Per cross-cutting §1.4.)

### 3.3 Drawer (xs / sm / md / lg / xl)

- xs: 100 vw, slides over content
- sm: 85 vw
- md+: 320 px, slides over content (desktop) or pushes (xl with room)

Per cross-cutting §3, contents are the same on all tiers. On mobile
the Drawer overlays; on xl it can dock (persistent). Drawer side: LTR
default left, RTL default right (cross-cutting §3.3).

### 3.4 Hardware back button (Android) — see §12

The Android hardware back button (and the gesture nav pill / 2-finger
swipe) follows a deterministic stack:

1. If a modal/sheet/⌘K is open → close it.
2. Else if a context menu / multi-select is active → cancel it.
3. Else if inside a sub-view (Game Hub tab, Console section, Files
   sub-directory, Tasks sub-view) → navigate up.
4. Else if on a tab root → the OS handles (minimize app / go home).

The app maintains an explicit `backStack` (a stack of "back intents").
Each navigation push pushes an entry; modals push a "close me" entry.
This is documented fully in §12.

---

## 4. Touch Target & Gesture Library

### 4.1 Touch target minimums

Per v5-design §8.1 and cross-cutting §1.2. Every interactive element
is ≥ 44 × 44 px on `inputMode() === "touch"`. The shared primitives
(Button, IconButton, Checkbox, Toggle) all have a 44 px hit area with
optional visual padding (the visible button can be 36 px on `sm` size
but the clickable area is 44).

### 4.2 Gesture library (canonical)

| Gesture | Meaning | Where |
|---------|---------|-------|
| Tap | Activate / open | everywhere |
| Long-press (450 ms) | Context menu / multi-select mode | lists, grids, files, saves, processes |
| Long-press (1.5 s) | Destructive confirm (power off, system process kill) | destructive actions |
| Swipe left on a row | Reveal inline actions (delete, etc.) | lists (Tasks, Notifications, Saves) |
| Swipe right on a row | Alternate action (mark read, etc.) | lists |
| Pull down (from top of scroll) | Refresh | list views (Library, Tasks, Notifications) |
| Pinch open / close | Zoom | fan curve graph, avatar crop, photos in Media |
| Drag (touch-and-hold then move) | Reorder / move | Game Hub tabs (reorder), Files clipboard |
| Edge swipe from left | Open Drawer | all screens (suppressed when banner is showing, File Browser §11.3) |
| Edge swipe from right (LTR) | Back (Android gesture nav) | all screens |
| Two-finger swipe | Switch Console section (left/right) | Console tab |
| Three-finger tap | Toggle ⌘K (accessibility) | all screens |

### 4.3 Long-press vs swipe ambiguity

A row can support both long-press (context menu) and swipe (inline
action). They don't conflict because:
- Long-press fires on `pointerup` after a 450 ms hold without movement
  beyond 8 px.
- Swipe fires on `pointermove` beyond 16 px horizontal.

If the user starts a swipe, long-press is cancelled. If they hold
still for 450 ms, long-press fires and subsequent movement is the
"context menu repositioning" (ignored).

### 4.4 Haptic vocabulary (resolves M10)

Canonical (cross-cutting §6.5 + this doc). One shared `haptic(kind)`
function in `lib/haptics.ts`:

```ts
type HapticKind = "tap" | "confirm" | "danger" | "selection";
function haptic(kind: HapticKind): void {
  if (!isAndroid()) return;                    // no Vibration on iOS WebView
  if (!settings.hapticsEnabled) return;
  const patterns: Record<HapticKind, number | number[]> = {
    tap: 10,
    confirm: 20,
    danger: [20, 50, 40],
    selection: 8,
  };
  navigator.vibrate(patterns[kind]);
}
```

| Event | Haptic | Source |
|-------|--------|--------|
| Tab change (bottom nav) | `tap` | nav |
| Button tap (primary) | `tap` | Button |
| Toggle change | `selection` | Toggle, Checkbox |
| Destructive confirm dialog opens | `confirm` | ConfirmDialog |
| Destructive action confirmed (power off) | `danger` | power control |
| Long-press context menu opens | `confirm` | row long-press |
| Alert fires (critical) | `danger` | alert evaluator |
| Task fails | `danger` | tasks store |
| Drag-reorder drop | `confirm` | reorder |

Silenced by Settings → Accessibility → Haptic feedback (default ON).
On iOS (Tauri iOS not yet shipped), `navigator.vibrate` is undefined;
the function is a no-op (resolves M20).

### 4.5 Soft keyboard

| Input type | Action key | Behavior |
|------------|-----------|----------|
| Search (⌘K, Files search) | Search | Submits query |
| Shell command | Run | Executes |
| IP address (Connection) | Next | Focus moves to next field or "Connect" button |
| Form (Settings) | Next / Done | Next moves focus; Done dismisses keyboard |
| Numeric (port, threshold) | Done | Dismisses |

The keyboard's "Done" should always be wired. ⌘K search uses
`enterkeyhint="search"`; shell uses `enterkeyhint="send"`. The
`visualViewport` API is used to scroll the focused input into view
above the keyboard (Android resize behavior is fine; iOS overlay needs
explicit offset).

### 4.6 Orientation lock

Per-screen orientation policy:

| Screen | Lock | Why |
|--------|------|-----|
| Fan curve editor | `landscape` (recommend, not force) | more horizontal temp range visible |
| Media video playback | follow device | user choice |
| Avatar crop | follow device | — |
| Everything else | follow device | — |

We do NOT force orientation anywhere — recommend landscape for the
fan curve editor via a subtle "Rotate for more room" hint that
dismisses on rotation. Forcing orientation breaks tablet users.

---

## 5. Per-Tab Mobile Patterns

### 5.1 Home (xs/sm)

- Widgets stack vertically, full width.
- "Quick actions" becomes a 2 × 3 grid (per Home/Console §5.2).
- "At a glance" collapses to one line; tap expands.
- Connection card is always pinned at top, not removable.

### 5.2 Games (xs/sm)

- Grid: 3 columns portrait, 4–5 columns landscape.
- Spotlight panel (Phase 5.3): becomes a **peek sheet** — long-press
  a tile → bottom sheet with art + actions. Tap → Game Hub.
- Swipe left/right on the grid: cycle filter (installed → library →
  updates → favorites).

### 5.3 Game Hub (xs/sm)

Per Game Hub §4.1:
- Header: cover (smaller, 64 px), title, title_id, status pill.
- Action buttons: one primary (`Launch`) + one kebab (`⋮`) for the
  rest (Launch with cheats, Uninstall, Edit artwork).
- Tabs: horizontally swipeable strip. Swipe changes tab. Active tab
  underlined. Tabs scroll horizontally if they overflow (8 tabs).
- Tab content fills remaining viewport above the bottom nav.
- Per-tab specifics:
  - **Cheats** (§7): toggles full-width; engine selector as a
    `<Select>` (44 px). "Download more" opens a full-screen repo
    browser.
  - **Saves** (§8.3): each slot is a card; kebab menu for Backup /
    Restore / USB actions (replaces v4's 4 inline buttons).
  - **Media**: 3-col grid (screenshots), horizontal scroller (videos).
    Tap → fullscreen viewer with swipe.
  - **Add-ons**: list with kebab menus.
  - **Updates**: list with "Install" buttons.
  - **Storage** (incl. SDK): cards with kebab menus.
  - **Play Time**: graph (vertical bar chart works portrait).

### 5.4 Files (xs/sm)

Per File Browser §13 in full. Single pane. Breadcrumbs at top with
back arrow. Bottom-sheet actions on row tap. Multi-select via
long-press. Clipboard banner docks above bottom nav. No dual pane.

### 5.5 Console (xs/sm)

Per Home/Console §7.3, §19:
- 12 sections become a horizontally swipeable strip at the top
  (below the alert banner). Active section underlined.
- Two-finger swipe left/right also changes section (big-screen
  gesture).
- Per-section mobile details in §19 of Home/Console (Thermal fan
  curve drag handles, Shell input bar, Process table collapse, etc.).
- Thermal graph scrolls horizontally to see more history.

### 5.6 Tasks (xs/sm)

- Single-column list. Each task is an expandable card.
- Active tasks: progress bar + cancel/pause inline.
- Sub-view switcher: a horizontally swipeable strip (Active / Recent /
  History / Statistics / Telemetry).
- Tap a task → detail sheet (full progress, error, retries).

### 5.7 Modals (xs/sm)

- All modals are **bottom sheets** by default (slide from bottom,
  full-width, max-height 90 vh, scrim tap to close).
- Drag-handle visible at top (40 px tall pill). Swipe down dismisses.
- Confirm dialogs are also bottom sheets (not centered).
- ⌘K is full-screen.

---

## 6. Android WebView Hardening

### 6.1 Already shipped (v4)

Per File Browser §13.6 and v5-design §9.4, v4 already has:
- `text-size-adjust: 100%` (prevents font zoom on orientation change)
- `min-width: 0`, `overflow-wrap: (sensible defaults)`
- `env(safe-area-inset-*)` in 4 locations
- `overscroll-behavior: contain` on scrollable lists
- `touch-action: manipulation` on buttons (removes 300 ms delay)
- `-webkit-tap-highlight-color: transparent`
- Scoped Storage path picker (`LocalPathPicker`)

### 6.2 Safe-area handling (resolves M16)

v5 adds safe-area to every edge — the v4 4-location set is incomplete.
Canonical:

```css
.app-shell {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
.bottom-nav {
  padding-bottom: max(env(safe-area-inset-bottom), 8px);
  height: calc(56px + env(safe-area-inset-bottom));
}
.top-bar {
  padding-top: env(safe-area-inset-top);
  height: calc(44px + env(safe-area-inset-top));
}
.modal-sheet {
  padding-bottom: env(safe-area-inset-bottom);
  border-radius: 16px 16px 0 0;
}
.input-field {
  /* inputs already handle this; ensure tap target ≥ 44 with safe-area */
}
```

The `max(env(...), X)` pattern guarantees minimum spacing even when
the device reports 0 (older Android).

### 6.3 Pull-to-refresh vs overscroll-contain (resolves M11)

Conflict: `overscroll-behavior: contain` is needed on scrollable
lists (prevents the Android Chrome pull-to-refresh from firing mid-
scroll), but pull-to-refresh IS a feature on Library / Tasks /
Notifications. Resolution:

- Global: `overscroll-behavior-y: contain` on `<body>` (kills the
  browser's pull-to-refresh).
- Per-list-with-pull-to-refresh: a custom `<PullToRefresh>` component
  that listens to `touchstart` / `touchmove` / `touchend` and renders
  its own indicator. The `overscroll-behavior` on these lists is
  `contain` too — the component handles the gesture, not the browser.

This avoids the "browser pull-to-refresh firing when the user
intends to refresh our list" bug.

### 6.4 Font size zoom (resolves M17)

`text-size-adjust: 100%` is set globally. Android WebView's text
sizing is controlled by Settings → Accessibility → "Text scaling"
which the WebView respects via `rem`. Our base size is 16 px =
1rem; if the user sets 120% text scaling in Android settings, all
`rem`-sized text scales. We do NOT fight this — accessibility is
a feature.

Layout that needs to NOT scale (icons, hit areas) uses `px` sizing.
Layout that should scale (body text) uses `rem`. Already true in v4;
v5 keeps it.

### 6.5 System status bar color (resolves M19)

The Android system status bar (the OS one, not the app's bottom
status strip) color is set via Tauri's `set_status_bar_color` plugin
(or the `theme_color` in `tauri.conf.json`). v5 sets it dynamically
to match the app theme:

- Dark/OLED theme: `#000000`
- Light theme: `#ffffff`
- Rose theme: matches rose accent

Light/dark icon color follows. On iOS (future), the status bar style
follows `UIStatusBarStyle` (default / lightContent).

---

## 7. Tauri Mobile Limitations

### 7.1 What Tauri Mobile IS

Tauri Mobile (as of v2) ships Android and iOS targets. The WebView
is system-provided (Android WebView on Android, WKWebView on iOS).
Rust code runs in the app process; Tauri commands bridge JS ↔ Rust
the same way as desktop.

### 7.2 What Tauri Mobile does NOT do (resolves M3)

| Capability | Desktop | Android | iOS (planned) |
|------------|---------|---------|---------------|
| Long-running background task | ✓ (OS process) | ✗ (Doze kills after ~1 min) | ✗ (BG app sweep) |
| Cron schedule while backgrounded | ✓ | ✗ (AlarmManager not exposed by Tauri) | ✗ |
| Outbound file watchers | ✓ (notify crate) | ✗ | ✗ |
| Local network broadcast (mDNS) | ✓ | partial (WebView socket limits) | ✗ |
| Wake-lock (screen on) | ✓ (caffeinate / systemd-inhibit) | ✓ (Wake Lock API) | ✓ (IdleTimer) |
| Foreground service (ongoing notification) | N/A | ✗ (not exposed; would need a Tauri plugin) | N/A |

**Implications for the design:**

1. **Automations / schedules** (Task System §12) **do NOT fire while
   the app is backgrounded on mobile.** When the user opens the app,
   missed firings are evaluated: any cron expression whose time passed
   while backgrounded runs once on next foreground (catch-up), unless
   the rule says "skip if missed". Documented in Settings → Automation
   with a "Mobile: schedules only run while the app is open" notice.
2. **Long uploads** (Task System §10) — when the app is backgrounded,
   the OS eventually pauses the WebView's network. The transfer-port
   connection drops. On next foreground, the disconnect watcher
   detects "back", paused tasks resume via `txIdHex`.
3. **Mirror jobs** (File Browser §11.4) — same constraint. Mirror is
   a foreground-only concept on mobile.

### 7.3 Foreground service (future, not in v5)

A proper Android foreground service (with an ongoing notification
"N transfers running") would let uploads continue. This requires a
custom Tauri plugin. **Out of scope for v5.0.** Documented as a
limitation. When it ships, the Task System scheduler will route
"running while backgrounded" tasks to the foreground service and
the UI will show the OS notification.

### 7.4 WebView network constraints

Android WebView runs the JS engine in the app process. WebSocket
works. SSE works (it's just a long-lived HTTP stream). Fetch works.
The transfer port (9021/9113/9114) is reached via the LAN — same as
desktop. No NAT issue (PS5 is on the same LAN as the phone, normally).

If the phone is on a different network (cellular, remote), the user
must configure port forwarding or a VPN. Out of scope.

### 7.5 IPC bridge overhead

Tauri commands on mobile serialize via the WebView bridge (JSON).
Large payloads (file uploads) do NOT go through the bridge — they go
directly to the engine via fetch (the engine is reachable on the LAN).
The bridge is for control commands only. v5 keeps this pattern; large
data stays on the network path.

---

## 8. Scoped Storage & File Access

### 8.1 The Android Scoped Storage model (resolves M5)

Android 11+ enforces Scoped Storage: an app can only write to its own
app-specific directory (`/sdcard/Android/data/<pkg>/files`) without
permission. Reading the shared storage (Downloads, Documents) requires
the `READ_EXTERNAL_STORAGE` permission or the
`ACTION_OPEN_DOCUMENT_TREE` intent (grants a tree URI).

ps5upload's flow (existing in v4):
1. App opens → `localFs.accessGranted()` checks if a tree URI is
   stored.
2. If not → `AndroidStorageAccessBanner` (AppShell.tsx:705) prompts
   the user to grant via the system picker. Stored as a persisted
   URI.
3. All file/folder picks go through `pickPath.ts` which branches:
   `isAndroid()` → in-app Scoped Storage browser backed by the
   DocumentFile API via the persisted URI; desktop → native dialog.

v5 keeps this flow but consolidates the banner into the Connection
card's first-run wizard (cross-cutting §6.1) — instead of a separate
banner, storage access is the FIRST step of the first-run wizard on
Android. The banner re-appears if access is revoked.

### 8.2 What lives where on Android

| Path | Used for | Access |
|------|----------|--------|
| `/sdcard/Android/data/.../files/ps5upload/` | App-private: logs, cache, downloaded payloads, telemetry ring buffer | always |
| Persisted tree URI (user-picked) | User's chosen download/upload/payload directory | granted via picker |
| `/data/data/.../databases/` | SQLite (Activity, AuditLog, telemetry archive) | always |
| `localStorage` (WebView) | Settings, roster, widget order | always |
| PS5 filesystem (via FTP / engine FS API) | Remote browsing | via network |

### 8.3 Upload source on Android

The Upload source picker (Files tab → Upload action) uses Scoped
Storage: the user picks files from the granted tree URI. Multi-select
is supported. .pkg files route to the install dialog. .zip/.7z/.rar
offer extract-on-upload (existing).

### 8.4 Download destination on Android

Downloads from PS5 → phone save to the user's granted tree URI (or
the app-private dir if no tree granted). The destination picker shows
both. "Save to Downloads" is offered as a shortcut that re-uses the
last-chosen directory.

### 8.5 Share-to-app (resolves M6)

Android intent filter: register the APK to receive
`application/vnd.android.package-archive` (.pkg) and
`application/octet-stream` / general MIME for .elf/.bin/.lua/.jar.
When another app shares a file, ps5upload opens with:

- A modal "Open this file in ps5upload? [Cancel] [Open]"
- For .pkg: route to Install PKG modal pre-filled with the shared
  path (URI).
- For .elf/.bin/.lua/.jar: route to Send Payload modal (custom file).
- For anything else: route to Files → Upload mode with the file pre-
  selected.

Tauri exposes the shared intent via `app_handle().on_event(Event::
Opened { urls })`. The client subscribes and routes. (Resolves M6.)

---

## 9. Keep-Awake, Backgrounding & Foreground Service

### 9.1 The keep-awake story today

Per `keepAwake.ts` and `androidScreenWake.ts`:
- On desktop: a Rust inhibitor (caffeinate / systemd-inhibit) holds
  wake while transfers are active.
- On Android: the Rust inhibitor is a no-op. Instead, the WebView's
  Wake Lock API (`navigator.wakeLock.request("screen")`) holds the
  screen on. This works while the app is foregrounded.

### 9.2 Auto keep-awake during transfers

The existing `useTransferKeepAwakeHold` (in `activityWiring.ts`) sets
a wake-lock reason `"transfer"` while any upload/download/backup is
running. The manual toggle uses reason `"manual"`. Both stack — the
wake-lock stays active while either reason is held.

### 9.3 Auto-disable policy (resolves M8)

Problem: a 30 GB upload over a slow link might take 3 hours. Holding
the screen on for 3 hours drains battery and burns the OLED. Policy:

| Condition | Action |
|-----------|--------|
| Transfer in progress AND battery > 30% | keep-awake ON |
| Transfer in progress AND battery 15–30% | keep-awake ON but show warning |
| Transfer in progress AND battery < 15% | keep-awake OFF; show "Saving battery — transfer continues if app stays open" |
| Transfer in progress AND plugged in (USB) | keep-awake ON always |
| Manual toggle ON | keep-awake ON regardless |
| Manual toggle ON AND battery < 5% | keep-awake ON with final warning (user override) |

Battery level via `navigator.getBattery()` (Android WebView). Plugged-
in state from the same API. Documented in Settings → Transfers →
"Keep screen on during transfers".

### 9.4 Backgrounding during a transfer

When the app is backgrounded:
1. Wake lock is released (the screen will time out normally).
2. The OS will eventually pause the WebView's network (Doze after ~1
   min on Android).
3. The transfer-port connection drops.
4. On next foreground, the disconnect watcher detects "back", paused
   tasks resume via `txIdHex`.

The user is informed via a toast on backgrounding: "App backgrounded
— transfer will pause. Keep the app open to continue." (Best we can
do without a foreground service — §7.3.)

### 9.5 Foreground service (out of scope for v5.0)

Documented limitation. When shipped (v5.x), the foreground service
will:
- Hold an ongoing notification "ps5upload — N transfers running".
- Keep the WebView's network alive.
- Allow schedules to fire.
- Be opt-in (Settings → Transfers → "Background transfers").

---

## 10. Install / Update / First-Launch Flow

### 10.1 APK distribution

The Android APK is built via `cargo tauri android build`. Distributed
via GitHub Releases (sideload). Not on Play Store (PS5-jailbreak-
adjacent tools won't pass Play review). The APK is signed with the
project's release key.

### 10.2 First launch

1. Android shows the "Install from unknown sources" prompt (per-app
   on Android 8+). User grants.
2. App launches. Splash screen (§10.5).
3. First-run wizard (cross-cutting §6.1, Home/Console §6.1) — but on
   Android, an extra step 0: storage access (§8.1).
4. After wizard, land on Home tab.

### 10.3 Update flow

Two channels:
- **In-app update check** (Settings → About → "Check for updates"):
  fetches GitHub Releases API, shows latest, downloads APK to the
  granted tree URI, prompts user to install (Android's package
  installer takes over).
- **GitHub release notification** (existing `state/update.ts`): on
  app foreground, checks for new release. Shows a banner with
  "Update available — v5.0.1" → user taps → downloads APK → installs.

Self-update via Tauri's updater plugin is NOT used on Android (it
only works for desktop formats). Manual APK reinstall is the path.

### 10.4 Migration between versions

- localStorage keys are versioned (`ps5upload.<key>.v1`).
- SQLite (Activity, AuditLog, telemetry archive) is migrated via
  standard schema_version pragma.
- The roster, connection host, widget order all survive an update.

### 10.5 Splash screen (resolves M18)

Tauri Mobile supports a splash screen. v5 uses a simple one:
- Solid background = theme color (dark default).
- Centered logo (the ps5upload controller icon).
- Fades out when React mounts.

Configured in `tauri.conf.json` → `app.windows[0].splashscreen`.

---

## 11. Intents, Sharing & Deep-Links

### 11.1 Inbound: share-to-app (resolves M6)

Per §8.5. Android intent filter for `.pkg`, `.elf`, `.bin`, `.lua`,
`.jar`. Other app shares → Files → Upload.

### 11.2 Inbound: deep-link

Per cross-cutting §2.3. Register `ps5upload://` scheme via
`tauri.conf.json` → `app.deepLinks`. External apps / browser links /
QR codes can deep-link into a specific Game Hub, File path, etc.

### 11.3 Outbound: share-from-app

"Share" actions in the app:
- Game Hub → Media → screenshot: "Share" → Android share sheet →
  user picks target (Messages, email, social).
- Tasks → History → "Export CSV": "Share" → share sheet with the CSV.
- Console → System Info → Syslog → "Share log": share sheet with the
  log file.

Implemented via Tauri's share plugin (`plugin:share`). On desktop,
"share" falls back to "Save to file" or "Open mailto".

### 11.4 Outbound: open-in-other-app

- Files → selection → .pkg → "Open in Package Installer" (Android
  system installer). Rarely needed (we install via the engine) but
  offered as a fallback for stubborn PKGs.
- Game Hub → Media → screenshot → "Open in Photos" (copy to the
  system Photos via Scoped Storage).

---

## 12. Hardware Back Button (resolves M2)

### 12.1 The back stack

The app maintains an explicit `backStack: BackEntry[]` in a
`useBackStackStore`. Each entry describes how to "go back":

```ts
type BackEntry =
  | { kind: "close-modal"; id: string }
  | { kind: "close-sheet"; id: string }
  | { kind: "close-palette" }
  | { kind: "close-context-menu" }
  | { kind: "exit-multi-select" }
  | { kind: "navigate"; to: string; state?: any }
  | { kind: "fs-up" }      // Files: go up one directory
  | { kind: "hub-tab-back" } // Game Hub: back to overview
  | { kind: "console-section-back" } // Console: back to default section
  | { kind: "app-exit" };   // nothing left — let OS handle
```

Every push of a modal/sheet/palette pushes an entry. Every navigation
pushes a `navigate` entry. Files directory changes push `fs-up`. Game
Hub tab changes push `hub-tab-back` (only when leaving Overview).

### 12.2 Handling the back button

On Android, the back button / gesture fires Tauri's
`window.__TAURI__.os.onBackPressed` (or a custom plugin). The handler:

```ts
function onBack(): boolean {
  const stack = useBackStackStore.getState();
  const top = stack.top();
  if (!top) return false;             // let OS minimize
  switch (top.kind) {
    case "close-modal": closeModal(top.id); break;
    case "close-sheet": closeSheet(top.id); break;
    case "close-palette": closePalette(); break;
    case "close-context-menu": closeContextMenu(); break;
    case "exit-multi-select": exitMultiSelect(); break;
    case "navigate": navigate(top.to, { state: top.state }); break;
    case "fs-up": fsUp(); break;
    case "hub-tab-back": setHubTab("overview"); break;
    case "console-section-back": setSection("thermal"); break;
    case "app-exit": return false;
  }
  stack.pop();
  return true;                        // consumed
}
```

### 12.3 Edge cases

- **Multi-select active + back**: exits multi-select (does NOT
  navigate).
- **Editing a form + back**: prompts "Discard changes?" — Cancel
  keeps the form, OK discards and goes back.
- **Task running + back from Tasks tab**: navigates normally; task
  continues.
- **Search active + back**: exits search (clears query), stays on
  Files tab.
- **Modal stack (modal over modal)**: back closes the topmost modal
  only.
- **App-exit on root**: returns false → OS minimizes. Standard
  Android behavior.

### 12.4 Back button on iOS (future)

iOS has no hardware back. The swipe-from-left-edge gesture is the
equivalent. The same `backStack` handles it (we listen to a swipe
gesture on the left edge). Within web standards, this is a custom
implementation.

---

## 13. Notifications & OS Integration

### 13.1 OS notification mirroring (resolves M7)

Existing behavior (`state/notifications.ts`): when the app is
backgrounded, in-app notifications mirror to the Android notification
center. Toggle in Settings → Notifications → "Mirror to system
notifications".

### 13.2 Doze / App Standby

Android Doze (after ~30 min idle on battery) defers all pending
notifications to a maintenance window. App Standby (app not used for
a while) further restricts. Implications:

- Notification mirroring might be delayed by Doze. Acceptable for
  "transfer complete" — the user isn't actively watching anyway.
- **Critical alerts** (thermal, payload lost) should use a
  high-priority notification channel so they bypass Doze. v5 sets up
  two channels: `default` (normal priority) and `critical` (high
  priority, makes a sound).
- The `critical` channel requires the user to grant "Override Do Not
  Disturb" permission (Android 7+). First critical alert prompts for
  this.

### 13.3 Notification channels

| Channel | Priority | Used for |
|---------|----------|----------|
| `transfers` | default | Upload/download/backup complete |
| `tasks` | default | Task failures, retries |
| `alerts` | high | Thermal alerts, payload lost |
| `system` | low | PS5 reconnected, firmware changed |
| `foreground-service` (when shipped) | low (ongoing) | Background transfer progress |

### 13.4 Interactive notifications

Android supports action buttons on notifications. v5 wires:
- "Transfer complete" → [Open] (opens app to Tasks → Recent)
- "Task failed" → [Retry] (without opening the app)
- "Thermal alert" → [Pause tasks] / [Resume tasks]

Action handlers go through Tauri's notification plugin → broadcast
intent → app's BroadcastReceiver → routes to the relevant store.

### 13.5 Remote Play picture-in-picture (resolves M13)

The Remote Play section (Console → Remote Play) is normally a status
+ credential helper — it doesn't stream video. The actual Remote Play
*client* is chiaki/chiaki4deck, a separate app. v5 does NOT embed
Remote Play video. Out of scope.

If we did (future): PiP would be standard Android PiP mode
(`enterPictureInPictureMode`) when the user navigates away from a
video-playing surface. Not relevant for v5.0 since we don't play the
video.

### 13.6 Battery optimization prompt

On first transfer, prompt: "Disable battery optimization for
ps5upload? Required for transfers to continue reliably in the
background." → opens Android Settings → Battery → App optimization.
With the foreground-service caveat (§7.3), this is mostly cosmetic
in v5.0, but sets the stage.

---

## 14. Accessibility on Mobile

(Full accessibility in loops 71-80. Mobile-specific points here.)

- **Touch target minimums**: 44 × 44 px (cross-cutting §1.2).
- **Haptics**: silencable via Settings → Accessibility.
- **Font scaling**: respects Android's Text scaling (§6.4).
- **Screen reader (TalkBack)**: all interactive elements have
  `aria-label` / `contentDescription`. Decorative icons are
  `aria-hidden`.
- **Focus order**: follows visual order. Modals trap focus.
- **High contrast**: theme + a "High contrast" toggle in Settings →
  Accessibility that swaps to OLED with stronger borders.
- **Reduce motion**: respects `prefers-reduced-motion` (already in
  v4). Animations are disabled; transitions are instant.
- **Switch control / Voice Access**: standard Android a11y; works
  with our ARIA semantics.

---

## 15. Performance & Memory Budget

### 15.1 Memory budget

Android WebView mid-range phone: ~256 MB heap. Budgets:

| Component | Budget | Notes |
|-----------|--------|-------|
| Telemetry ring buffer | 4 MB | 24h of 2s snapshots × ~10 fields. Cull on memory pressure. |
| Library cache (icons) | 32 MB | LRU. Icons are JPEGs. |
| Tasks store (live) | 8 MB | Active + recent. History is in SQLite. |
| Game Hub state (per game) | 1 MB | Cheats list, saves list, media thumbnails. |
| Files listing | 2 MB per directory | Virtualize large dirs (windowing). |
| Media thumbnails | 16 MB | LRU. |
| **Total target** | **~80 MB** | Leaves headroom for WebView itself. |

On memory pressure warning (`document.addEventListener(
'visibilitychange')` + `performance.memory`), the app proactively
culls: clears old telemetry snapshots, drops LRU icons, evicts
terminal tasks beyond the 100-cap.

### 15.2 Cold-start budget

Target: < 2 s to interactive on a mid-range phone (Pixel 4a class).
- Tauri WebView init: ~600 ms
- JS bundle parse + exec: ~400 ms (code-split per tab; only Home
  loads eagerly)
- Initial data hydration (roster, settings): ~200 ms
- First paint of Home: ~300 ms

Code-splitting: each tab is a lazy-loaded route chunk. Only Home is
in the initial bundle. Drawer / modals / ⌘K are split out.

### 15.3 Scroll performance

- All lists are virtualized (`react-window` or equivalent). No list
  renders > 100 DOM rows.
- Game grid uses CSS Grid with `content-visibility: auto` on cells
  (Android WebView 83+ supports this).
- Images lazy-load with `loading="lazy"` and placeholders.
- Animations use `transform` / `opacity` only (GPU-composited).

### 15.4 Network budget

- One telemetry SSE stream (2 s cadence).
- Per-tab data fetches are debounced + cached.
- No polling in v5 (cross-cutting §5 of the v5-design). Mobile
  benefits most — radio saved.

---

## 16. Tablet / Large-Screen Mobile (resolves M9)

### 16.1 Tablet detection

Per §1.1: `formFactor() === "tablet"` when `isMobile()` AND
`viewportMin() >= 600`. iPad, iPad Pro, Galaxy Tab, Surface (when
touching), foldables in unfolded state.

### 16.2 Tablet layout

At `md` tier (768–1023 px):
- **Bottom nav stays** (tablets are still touch-first).
- Content is 2-column where sensible:
  - Home: widgets in a 2-col grid.
  - Games: grid 5-6 columns.
  - Files: single pane + context rail (not full dual-pane).
  - Console: section list becomes a 2-col master-detail (sections on
    left, content on right).
  - Tasks: 2-col list + detail.
- Modals are large sheets (90 vw), not full-screen.

At `lg` tier (1024+), it's desktop-like (left rail, dual-pane Files).

### 16.3 Foldables

- **Cover screen (small)**: treat as phone (`xs` / `sm`).
- **Inner screen (large)**: treat as tablet (`md`) — content
  re-flows.
- **Multi-window (split-screen)**: reads `visualViewport.width`. App
  sizes to the window, not the device.

### 16.4 iPad / iPadOS

Tauri iOS is not yet shipped. When it ships:
- Same `md` layout as Android tablets.
- No Vibration API.
- Different file picker (Files app integration via `UIDocumentPicker`).
- Different sharing (UIActivityViewController).

Documented for future; v5.0 ships Android only.

---

## 17. Phased Implementation

Mobile work is interleaved with the tab-build phases (cross-cutting
§12). Mobile-specific phases:

> **Note (R5, loops 81-90):** Phase suffixes here were originally `-m`/`-n`,
> which collided with the canonical `5.1-m` (Tasks tab) slot in
> cross-cutting §12. Renamed to `-mo` (mobile) to avoid collision. Content
> unchanged. Cross-cutting §12 is the source of truth.

### Phase 5.0-mo — Mobile foundation (1 week, parallel to 5.0)

- Extend `platform.ts` with `formFactor()`, `inputMode()`,
  `responsiveTier()`.
- Add `useResponsiveTier()` hook.
- Add `lib/haptics.ts`.
- Add `useBackStackStore`.
- Backfill safe-area in all remaining locations (§6.2).
- Verify `overscroll-behavior` + `<PullToRefresh>` everywhere.
- Ship the shared primitives (Button, IconButton, etc.) with mobile
  variants.

### Phase 5.1-mo — Per-tab mobile patterns (3 weeks, parallel to 5.1)

- Bottom nav component.
- Top bar with mobile status chips.
- Drawer mobile sheet.
- Per-tab mobile layouts (§5).
- Modal-as-bottom-sheet variant.
- Hardware back button wiring (§12).

### Phase 5.1-mo2 — Files mobile clipboard + selection (1 week)

- Pull File Browser §13 implementation.
- Clipboard banner above bottom nav.
- Bottom-sheet row actions.
- Multi-select via long-press.
- Edge-swipe-back suppression while clipboard active.

### Phase 5.2-mo — Platform integration (2 weeks)

- Scoped Storage first-run wizard step.
- Share-to-app intent filter + routing.
- Deep-link registration.
- OS notification channels (§13.3).
- Interactive notification actions.
- Keep-awake auto-disable policy (§9.3).
- Battery optimization prompt.

### Phase 5.3-mo — Mobile polish (1 week)

- Haptic vocabulary rollout everywhere.
- Pull-to-refresh on Library / Tasks / Notifications.
- Splash screen.
- Tablet 2-col layouts.
- Performance tuning (memory budgets, virtualization, code-split
  verification).

**Total: ~8 weeks of mobile-specific work**, fully parallel with the
tab builds. Net addition to the v5 timeline: ~0 weeks (parallelizable)
except Phase 5.3-mo which serializes after 5.3 polish.

---

## Appendix A — Mobile Gap Register (resolved)

See §0. All 20 mobile gaps are resolved above; resolutions are
binding on the four revised docs and the cross-cutting doc.

## Appendix B — Gesture cheat-sheet

| Gesture | Effect | Scope |
|---------|--------|-------|
| Tap | Activate | everywhere |
| Long-press (450 ms) | Context menu / multi-select | lists, grids |
| Long-press (1.5 s) | Destructive confirm | destructive |
| Swipe-left on row | Inline action | Tasks, Notifications, Saves |
| Swipe-right on row | Alt action | Tasks, Notifications |
| Pull down (top of scroll) | Refresh | lists |
| Pinch | Zoom | fan curve, avatar, photos |
| Drag | Reorder / move | tabs, clipboard |
| Edge swipe from left | Open Drawer | all |
| Edge swipe from right (LTR) | OS back | all |
| Two-finger swipe L/R | Switch Console section | Console |
| Three-finger tap | Toggle ⌘K | all |
| Drag-down on sheet | Dismiss | modals |
| Swipe L/R on tab strip | Change tab | Game Hub, Console, Tasks sub-views |
| Swipe L/R on Games grid | Cycle filter | Games |

## Appendix C — Platform capability matrix

| Capability | Desktop | Android | iOS (planned) |
|------------|---------|---------|---------------|
| Wake-lock | Rust inhibitor | Wake Lock API | IdleTimer (future) |
| File picker | Native dialog | Scoped Storage | UIDocumentPicker (future) |
| Background schedule | OS process | Foreground only | Foreground only |
| Long upload in BG | ✓ | ✗ (Doze kills) | ✗ |
| Wake on LAN | ✓ | ✓ | ✓ |
| Haptics | — | Vibration API | — |
| OS notifications | ✓ (native) | ✓ (channels) | ✓ (future) |
| Hardware back | n/a | ✓ | swipe-gesture |
| Share-to-app | ✓ (file open) | ✓ (intent filter) | ✓ (future) |
| Share-from-app | ✓ (mailto / file) | ✓ (share sheet) | ✓ (future) |
| Deep-link scheme | `ps5upload://` | `ps5upload://` | `ps5upload://` (future) |
| mDNS / roster discovery | ✓ | partial | ✗ |
| Memory budget | generous | ~80 MB | ~80 MB |
| Drag-and-drop | ✓ | ✗ | ✗ |
| Self-update | Tauri updater | APK reinstall | App Store (theoretical) |

---

*This document is the plan of record for mobile / Android in v5. It
consolidates mobile decisions from the four revised docs and the
cross-cutting doc, adds platform-layer concerns those docs hand-wave,
and is binding on all five prior design documents. Each revised doc
remains authoritative for its own tab's detail; this document is
authoritative for everything mobile-specific.*
