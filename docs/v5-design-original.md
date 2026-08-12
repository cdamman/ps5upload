# ps5upload v5.0 — Design & Architecture Plan

> **Status: historical.** This document is kept for the reasoning
> behind decisions that have since shipped. It describes intent at the
> time of writing, not current behaviour — check the code, `CHANGELOG.md`
> or `FAQ.md` before relying on anything here.

> **Goal**: Redesign the app from a flat 40-screen toolset into a cohesive,
> workflow-driven PS5 companion. Focus: fewer places to look, features that
> work together, touch-friendly controls, beautiful visual design.
>
> Status: **PLANNING** — no code written yet.

> ⚠️ **ARCHIVAL NOTICE (loops 81-90, R6-R13).** This is the *original* v5 design
> doc. Multiple sections have been **superseded** by focused follow-on docs that
> refine, correct, or replace the design here. Per-section banners below mark
> each supersession. Treat this doc as historical context; for the canonical
> current design, see:
> - `v5-cross-cutting-concerns.md` — canonical for navigation, routes, offline,
>   error policy, state, permissions, and the **phase plan (§12)**.
> - `v5-home-console-redesign.md` — supersedes §3.1, §3.4, §7 (Home/Console).
> - `game-hub-revised-design.md` — supersedes §5 (Game Hub, 8 tabs not 6).
> - `v5-file-browser-redesign.md` — supersedes §3 (Files), §4-E, §9.3, App B.
> - `v5-task-system.md` — supersedes §6 (Task System).
> - `v5-mobile-design.md` — supersedes §9 (Mobile/Android).
> - `v5-accessibility-design-system.md` — supersedes §8 (Components),
>   §10 (Visual Design Language), Appendix C (Component APIs).
>
> The consistency review register is `v5-consistency-review.md`.

---

## Table of Contents

1. [What's Wrong Today (v4.3.2)](#1-whats-wrong-today-v432)
2. [Design Principles for v5](#2-design-principles-for-v5)
3. [New Navigation Architecture](#3-new-navigation-architecture)
4. [Feature Integration Map](#4-feature-integration-map)
5. [The Game Hub — Central Workflow](#5-the-game-hub--central-workflow)
6. [Unified Task System](#6-unified-task-system)
7. [Telemetry & Live Data](#7-telemetry--live-data)
8. [UI Component Overhaul](#8-ui-component-overhaul)
9. [Mobile / Android Redesign](#9-mobile--android-redesign)
10. [Visual Design Language](#10-visual-design-language)
11. [Migration Path](#11-migration-path)
12. [Implementation Phases](#12-implementation-phases)

---

## 1. What's Wrong Today (v4.3.2)

### Navigation
- **40 flat sidebar items** in 6 sections. "System" alone has 16 items.
  Users can't find things. Features feel disconnected.
- **No task-centric workflows.** A user who wants to "back up my game saves,
  apply cheats, then launch the game" must visit 3 unrelated screens.
- **Mobile = hamburger drawer with 40 items.** Scrolling through a giant
  list on a phone is painful. No bottom nav, no quick actions.

### Feature Silos
- **Cheats** live on `/cheats` — completely disconnected from the game
  library, installed apps, and game activity.
- **Saves** live on `/saves` — disconnected from backup, from the game
  they belong to, and from transfer log.
- **Fan curve** + **hardware temps** + **process list** are 3 separate
  screens that all answer "how is my PS5 doing right now?"
- **FTP** + **File System** + **SMB** + **Search** + **Disk Usage** +
  **Volumes** = 6 file-related screens with no unifying browser.
- **Backup** can't snapshot individual game saves — it's a system-level
  feature, while per-game save management is on another screen.

### Engine/API Fragmentation
- **3 parallel job/status systems**: the main `jobs` map + SSE (uploads),
  FS ops' `op-status`/`op-cancel`, and PKG install's `install/status`.
- **6+ concurrent polls** on the Hardware screen (temps, power, fan,
  processes, SMP, storage) — each a separate HTTP round-trip.
- **Duplicate endpoints**: `proc/list` vs `process/list`, `hw/power` vs
  `power/telemetry`, `users/*` vs `profile/*`.
- **Unsafe REST**: `cheats/delete` and `cheats/reload` are GET with side
  effects (crawlers/prefetch can trigger them).

### Component/Design Issues
- **Touch targets fail 44×44px everywhere**: Button sm (~28px), Modal
  close X (~24px), ErrorCard dismiss (~16px), CommandPalette rows (~28px).
- **No shared form primitives**: Checkbox, Toggle, Input, Select, Tab —
  all hand-rolled per-screen with drift.
- **Button defaults to `size="sm"`** — pervasive small buttons.
- **ErrorBoundary has broken CSS tokens** (`--color-surface-hover`
  undefined, `text-white` hard-coded ignoring themes).
- **ConfirmDialog reimplements Modal** with divergent spacing/focus.
- **Saves screen: 4 tiny buttons per row** (Backup, Restore, Save-to-USB,
  Restore-from-USB) — visually busy, touch-unfriendly.

---

## 2. Design Principles for v5

1. **Game-centric, not feature-centric.** The user thinks "I want to do
   something with *this game*," not "let me visit the cheats page."
   Every per-game action (cheats, saves, launch, patch, backup) lives in
   one Game Hub.

2. **Progressive disclosure.** Show the 5 things 90% of users need.
   Bury the 35 things power users need behind search, command palette,
   or an "Advanced" section.

3. **One unified task list.** Uploads, downloads, installs, deletes,
   backups, cheat-downloads — all visible in one timeline with progress,
   cancel, and history.

4. **Touch-first.** Every interactive element ≥ 44×44px. Bottom nav on
   mobile. Swipe gestures for common actions.

5. **Live data, not polling.** One SSE stream for telemetry + task
   progress + system events. The UI subscribes, not polls.

6. **Consistency via shared primitives.** One Button, one Checkbox, one
  Toggle, one Modal, one Input, one Select, one Card — used everywhere.

---

## 3. New Navigation Architecture

### 3.1 From 40 items → 5 primary destinations

| Tab | Icon | Purpose |
|-----|------|---------|
| **Home** | `LayoutDashboard` | Dashboard: connection status, temps, running games, recent activity, quick actions |
| **Games** | `Gamepad2` | Game library: grid of all titles. Click any game → Game Hub. This replaces Library + Installed Apps + Cheats + Saves + Game Activity + SDK Changer + TMDB |
| **Files** | `FolderTree` | Unified file browser: PS5 filesystem, FTP, SMB, search, disk usage, volumes — all as tabs/modes within one browser |
| **Console** | `Cpu` | System control: hardware/sensors, fan curve, processes, power control, remote play, firmware spoof, notifications, nanoDNS, shell |
| **Tasks** | `Activity` | Unified task timeline: all active + completed transfers, installs, backups, cheat-downloads. History + stats |

**Plus: Global header elements:**
- Console selector (roster picker) — top bar, always visible
- Command palette (⌘K / Ctrl+K) — search + jump to any action
- Settings cog — opens settings drawer (theme, language, paths, advanced)

**Plus: Contextual actions in the header:**
- On Home: "Send Payload" button
- On Games: "Install PKG" button
- On Files: "Upload" button
- On Console: "FTP Server" toggle

### 3.2 Desktop layout

> ⚠️ **SUPERSEDED (R9).** The status-bar fields shown in the mockup below are
> revised in `v5-cross-cutting-concerns.md` §1.4 (C16). The layout shape is
> still accurate; only the chip set differs. Read that doc for the canonical
> status bar.

```
┌──────────────────────────────────────────────────────┐
│ [≡] PS5Upload  [Console: PS5 Pro ▾]    [⌘K] [⚙] [👤] │
├────────┬─────────────────────────────────────────────┤
│        │                                             │
│  Home  │                                             │
│  Games │            Main content area                │
│ Files  │                                             │
│ Console│                                             │
│ Tasks  │                                             │
│        │                                             │
│        │                                             │
├────────┴─────────────────────────────────────────────┤
│ [▶ Upload progress] [12 fps] [65°C]     [v5.0.0]     │
└──────────────────────────────────────────────────────┘
```

- Left sidebar: 5 primary tabs, 56px wide, icon-only (with tooltip +
  keyboard number shortcuts Alt+1..5)
- Roster picker in the header (dropdown, not sidebar)
- Status bar at bottom: active task summary, live temp, FPS, version
- Collapsible sidebar (remembers preference)

### 3.3 Mobile / Android layout — Bottom nav

> ⚠️ **SUPERSEDED (R8).** The drawer contents shown here are revised in
> `v5-cross-cutting-concerns.md` §3.1 (C11). The bottom-nav shape is still
> accurate; for the canonical drawer item list and the full mobile design
> (responsive tiers, back-button handling, Scoped Storage, etc.), see
> `v5-mobile-design.md`.

```
┌──────────────────────────────┐
│ [≡] PS5Upload      [⚙]      │  ← top bar (safe-area)
├──────────────────────────────┤
│                              │
│                              │
│       Main content           │
│                              │
│                              │
│                              │
├──────────────────────────────┤
│ [🏠] [🎮] [📁] [⚙️] [📋]     │  ← bottom nav (safe-area)
└──────────────────────────────┘
```

- **Bottom navigation bar**: 5 primary tabs, 56px tall + safe-area-inset,
  each ≥ 44×44px touch target
- Top bar: hamburger (opens drawer for secondary screens), app name,
  settings cog
- Drawer: secondary/advanced screens (Payloads, Logs, Bug Report, FAQ,
  About, Changelog, Audit Log) — NOT the primary features
- **Swipe left/right** on Games grid → browse categories
- **Pull to refresh** on list views

### 3.4 What happens to the 40 screens?

| Current screen (v4) | New location (v5) |
|---------------------|-------------------|
| Dashboard | **Home** tab |
| Connection | **Home** → "Connect" card (or first-run wizard) |
| Upload | **Files** tab → "Upload" action button |
| Install Package | **Games** tab → "Install PKG" button |
| Library | **Games** tab (merged with Installed) |
| Installed Apps | **Games** tab (merged with Library) |
| File System | **Files** tab |
| Search | **Files** tab → search mode toggle |
| Volumes | **Files** tab → sidebar/volume selector |
| Disk Usage | **Files** tab → "Disk Usage" mode |
| Hardware | **Console** tab → "Sensors" section |
| Processes | **Console** tab → "Processes" section |
| Fan Curve | **Console** tab → "Thermal" section |
| Remote Play | **Console** tab → "Remote Play" section |
| Notifications | **Console** tab → "Notifications" section |
| Profile | **Console** tab → "Profile" section (or header avatar) |
| FTP Server | **Console** tab → "Network Services" section |
| SMB Browser | **Files** tab → "SMB" mode |
| nanoDNS | **Console** tab → "Network Services" section |
| Shell | **Console** tab → "Shell" section (or ⌘K command) |
| Cheats | **Game Hub** → "Cheats" tab per game |
| Saves | **Game Hub** → "Saves" tab per game |
| Game Activity | **Game Hub** → "Activity" tab per game |
| SDK Changer | **Game Hub** → "SDK" tab per game |
| TMDB | **Game Hub** → "Artwork" action per game (auto on install) |
| FwSpoof | **Console** tab → "Firmware" section |
| Backup | **Console** tab → "Backup" section |
| Activity (Transfer Log) | **Tasks** tab |
| Stats | **Tasks** tab → "Statistics" sub-tab |
| Logs | **Drawer** → "Logs" |
| Audit Log | **Drawer** → "Audit Log" |
| Bug Report | **Drawer** → "Bug Report" |
| Payloads | **Home** → "Send Payload" card (or Drawer) |
| Screenshots | **Game Hub** → "Media" tab per game (or Files → filter) |
| Videos | **Game Hub** → "Media" tab per game (or Files → filter) |
| FAQ | **Drawer** → "Help" |
| About | **Drawer** → "About" |
| Settings | Header **⚙** cog → settings drawer |
| Changelog | **Drawer** → "What's New" (or shown on update) |
| First Run | Unchanged — onboarding wizard |

**Net result**: 5 primary tabs + 1 drawer. Users see 5 things, not 40.

---

## 4. Feature Integration Map

### 4.1 The "Three Contexts"

Features should be organized by context, not by API:

| Context | What the user is doing | Features nearby |
|---------|----------------------|-----------------|
| **Game context** | "I'm looking at a specific game" | Launch, cheats, saves, screenshots, videos, activity, SDK patch, backup saves, artwork |
| **File context** | "I'm moving files around" | Upload, download, FTP, SMB, search, disk usage, file system |
| **System context** | "I'm managing the console itself" | Hardware, processes, fan, firmware, remote play, profile, shell, network services, backup, notifications |

### 4.2 Cross-feature integrations

These are the "1+1=3" connections that make the redesign worthwhile:

#### A. Install PKG → Auto-enrich (TMDB + icon + cheats)
**Today**: Install a PKG → it shows up with a blank icon. User must manually
go to TMDB screen to fetch art, then go to Cheats screen to download cheats.
**v5**: After a PKG install completes, the Tasks tab shows a button:
"Enrich this game" → fetches TMDB art + searches cheat repos + fetches
icon — all in one click. The game appears in the grid with full art.

#### B. Game Hub → Unified per-game actions
**Today**: To fully manage one game, visit 5 screens (Installed Apps for
launch, Cheats for cheats, Saves for saves, Game Activity for playtime,
SDK Changer for patches).
**v5**: Click any game tile → Game Hub with tabs:
- **Overview** — cover art, title ID, playtime, last played, SDK version,
  install size, current cheat status
- **Cheats** — list/toggle/download cheats for THIS game only
- **Saves** — backup/restore saves for THIS game only
- **Media** — screenshots + video clips for THIS game only
- **Patches** — SDK changer for THIS game only
- **Activity** — play history for THIS game

#### C. Backup → Smart suggestions
**Today**: Backup screen does system snapshots. Saves screen does per-game
save backups. They don't know about each other.
**v5**: On the Console → Backup section, show a "Recommended actions" card:
"You have 23 games with unbacked-up saves (last backup: never)."
[Back up all saves] button does a bulk job.

#### D. Fan Curve + Hardware = Thermal Dashboard
**Today**: Fan curve on one screen, temps on another, no live feedback loop.
**v5**: Console → Thermal section shows live temps + fan RPM + power draw
in one view, with the fan curve editor overlaid on the same chart.
Adjust the curve → see the effect immediately.

#### E. FTP + File System = Unified Browser
**Today**: FTP server is a toggle on one screen. File System is a separate
browser. SMB is a third browser.
**v5**: Files tab has a "location" sidebar:
- PS5 (internal SSD)
- PS5 (USB / extended)
- PS5 (FTP — browse via the FTP server running on the payload)
- SMB share (add server)
- Local (host machine)
One browser, one toolbar, one keyboard shortcut set. Copy/move between
any locations via drag-and-drop or copy-paste.

#### F. Tasks → Everything in one timeline
**Today**: Transfer Log shows uploads/downloads. PKG install progress is
on the Install screen. Backup has no progress. Cheats download has no
progress.
**v5**: Tasks tab shows a unified timeline:
```
[████████░░] Installing Astro's Playroom.pkg     2.1 GB / 3.2 GB  [Cancel]
[██████████] Upload complete: /data/themes/...                      ✓
[░░░░░░░░░░] Backing up saves (12 of 23 games)                   [Cancel]
[██████████] Cheats downloaded: GoldHEN for CUSA00506               ✓
```

#### G. Command Palette → Quick actions

> ⚠️ **SUPERSEDED (R11).** The action list below is the original sketch. The
> canonical ⌘K spec — covering navigate / act / run-shell / jump-to-task
> (`#<task-id>`) — lives in `v5-cross-cutting-concerns.md` §4.5. Mobile
> behavior is in `v5-mobile-design.md` §5.2 (tap = full-screen Spotlight,
> long-press = peek sheet); component API is in
> `v5-accessibility-design-system.md` §19.21.

**Today**: Command palette searches screens.
**v5**: Command palette also offers actions:
- "Launch Astro's Playroom"
- "Backup all saves"
- "Start FTP server"
- "Set fan threshold to 70°C"
- "Kill process: SceShellUI"
Type the action, hit Enter. No navigation needed.

---

## 5. The Game Hub — Central Workflow

> ⚠️ **SUPERSEDED (R7).** This section describes **6 tabs** (Overview / Cheats /
> Saves / Media / Add-ons / Updates). The revised Game Hub has **8 tabs**:
> Overview, Cheats, Saves, Media, Add-ons, Updates, **Storage**, **Play Time**.
> The canonical design — including the Games-grid aggregator endpoint, sort &
> filter, favorites/collections, multi-select batch ops, and per-tab deep
> designs — lives in `game-hub-revised-design.md`. This section is retained
> only for historical context on the original tab concept.

### 5.1 Entry points

- **Games tab** → click any tile → Game Hub opens
- **Command palette** → type game name → "Open Game Hub: [name]"
- **Tasks tab** → click a completed install → "Open Game Hub"
- **Running game indicator** (status bar) → click → Game Hub for running game

### 5.2 Layout

```
┌──────────────────────────────────────────────────────┐
│  [← Back]                                             │
│                                                       │
│  ┌──────────┐  Astro's Playroom                       │
│  │          │  CUSA00506 · PS5 · 3.2 GB               │
│  │ [Cover]  │  Played 42h · Last: 2 days ago          │
│  │          │  SDK 9.00 · Cheats: 12 active           │
│  └──────────┘                                         │
│                                                       │
│  [▶ Launch]  [Cheats: 12/15]  [Saves: ✓]  [⚙ More]   │
├──────────────────────────────────────────────────────┤
│                                                       │
│  [Overview] [Cheats] [Saves] [Media] [Patches] [Activity]│
│                                                       │
│  ┌─ Overview ───────────────────────────────────────┐│
│  │                                                   ││
│  │  Installation                                     ││
│  │    Version: 1.02    Size: 3.2 GB                  ││
│  │    Installed: 2025-03-15    SDK: 9.00             ││
│  │                                                   ││
│  │  Cheats                  [12 active / 15 total]   ││
│  │    GoldHEN: 8 mods       [Manage →]               ││
│  │    etaHEN: 4 mods        [Manage →]               ││
│  │                                                   ││
│  │  Saves                   [✓ Backed up 3 days ago] ││
│  │    3 save slots          [Backup now]             ││
│  │                                                   ││
│  │  Media                   [14 screenshots, 3 clips]││
│  │    Last screenshot: today                         ││
│  │                                                   ││
│  │  Activity                                        ││
│  │    Total playtime: 42h    Sessions: 15            ││
│  │                                                   ││
│  └───────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### 5.3 Cheats tab (within Game Hub)

```
  Cheats for Astro's Playroom
  
  ┌─ Engine: [GoldHEN ▾]     [Refresh] [Download more] ─┐
  │                                                       │
  │  ┌─────────────────────────────────────────────────┐ │
  │  │ ☑ Infinite Health        [ON]                    │ │
  │  │ ☑ Infinite Stamina       [ON]                    │ │
  │  │ ☐ One Hit Kill           [off]                   │ │
  │  │ ☑ Super Jump             [ON]                    │ │
  │  │ ☐ Moon Gravity           [off]                   │ │
  │  │ ...                                               │ │
  │  └─────────────────────────────────────────────────┘ │
  │                                                       │
  │  Patches auto-apply on game launch: [Toggle ON]      │
  └───────────────────────────────────────────────────────┘
```

- Cheats are filtered to THIS game only (no scrolling through all games)
- Toggle = touch-friendly 44px switch
- "Download more" → repo browser filtered to this title_id
- "Patches auto-apply" = persistent toggle per game

### 5.4 Saves tab (within Game Hub)

```
  Save Data for Astro's Playroom
  
  Last backup: 3 days ago    [Backup all] [Restore]
  
  ┌─────────────────────────────────────────────────────┐
  │ Slot 1 — Main Save          2.3 MB    2025-07-30    │
  │ [Backup] [Restore] [Save to USB] [Restore from USB] │
  ├─────────────────────────────────────────────────────┤
  │ Slot 2 — NG+                 4.1 MB    2025-07-28   │
  │ [Backup] [Restore] [Save to USB] [Restore from USB] │
  └─────────────────────────────────────────────────────┘
```

- But now the buttons are proper size (44px) and use an **overflow menu**
  pattern on mobile (kebab icon → Backup/Restore/USB actions)
- "Backup all" creates a single zip in the Tasks tab

---

## 6. Unified Task System

> ⚠️ **SUPERSEDED (R6).** The full Task System design — the `Task` envelope,
> `TaskKind` union (now including `fs-rename` and `mirror`), retry modes and
> per-kind recoverability matrix, paused lifecycle state, pipelines/chaining,
> queue management, history consolidation, and the Tasks-tab UI — lives in
> `v5-task-system.md`. This section is retained only as the original sketch.

### 6.1 Engine changes

**Problem**: 3 parallel status systems today:
1. `/api/jobs` + `/api/events` SSE — for uploads/downloads
2. `/api/ps5/fs/op-status` — for FS delete/copy/move
3. `/api/pkg/install/status` — for PKG installs

**Solution**: Route everything through the existing `jobs` map + SSE:

```
POST /api/ps5/fs/delete     → { "job_id": "..." }    (instead of op_id)
POST /api/pkg/install/start → { "job_id": "..." }    (instead of separate status)
POST /api/ps5/backup/snapshot → { "job_id": "..." }  (currently no progress)
POST /api/ps5/cheats/repos/download → { "job_id": "..." }
```

All emit progress events on `/api/events`:
```json
{"type":"job_progress","job_id":"...","progress":0.65,"speed":"12 MB/s","eta":"2m"}
{"type":"job_complete","job_id":"...","result":{"ok":true}}
```

**Backward compat**: Keep old endpoints as thin wrappers that create a
job internally and poll it. Deprecate but don't break v4 clients.

### 6.2 Tasks tab UI

Three sub-views (tabs within Tasks):

**Active** — running jobs with live progress bars
**Recent** — completed in last 24h (collapsible)
**History** — full searchable/filterable history (from activity DB)

Plus a **Statistics** sub-tab:
- Total uploads/downloads this month
- Success/failure rate
- Average speed
- Most-installed games

---

## 7. Telemetry & Live Data

### 7.1 Unified SSE stream

**Today**: 6+ concurrent polls (temps, power, fan, processes, SMP, storage).

**v5**: One SSE endpoint:

```
GET /api/ps5/telemetry/stream
```

Server pushes a combined snapshot every 2s (or on-change):
```json
{
  "ts": 1234567890,
  "temps": {"cpu": 62, "soc": 58, "board": 45},
  "fan": {"rpm": 1850, "duty": 35},
  "power": {"draw": 85, "voltage": 12.1},
  "processes": {"count": 47, "top": [...]},
  "storage": {"internal": {"free": 245, "total": 667}},
  "running_app": {"title_id": "CUSA00506", "name": "Astro's Playroom"}
}
```

Client subscribes once, dispatches to all stores. Kills polling storm.

### 7.2 Live status bar

Bottom of every screen shows (from the telemetry stream):
```
[● PS5 Pro] [62°C CPU] [35% Fan] [85W] [CUSA00506 running]    [v5.0.0]
```

Clicking any element jumps to the relevant detail (Console tab → Thermal).

---

## 8. UI Component Overhaul

> ⚠️ **SUPERSEDED (R12).** The full component-primitive spec — ~28 primitives
> with WAI-ARIA pattern requirements, ≥44×44 touch targets, the canonical
> Button size (`md`, not `sm`), IconButton, Checkbox (20px mouse / 24px touch),
> the `lg` Button size, Toaster/useToast, Drawer, Sheet, Spotlight, DataGrid,
> EmptyState (§19.29 — resolves the 72vh bug to 55vh), and the full migration
> plan — lives in `v5-accessibility-design-system.md` §19. The token fixes
> (including the full ErrorBoundary broken-token list: `--color-bg` →
> `--color-surface`, `--color-surface-hover` → `--color-surface-3`,
> `text-white` → `--color-accent-contrast`) are canonical in that doc's §2.3
> and §20.1.

### 8.1 New shared primitives (all ≥ 44px touch targets)

```
components/
  Button.tsx        — variants: primary, secondary, ghost, danger
                       sizes: sm (36px), md (44px), lg (52px)
                       default: md (was sm)
  IconButton.tsx    — square, 44×44px, icon-only, aria-label required
  Checkbox.tsx      — 24px visual, 44px hit area (padding)
  Toggle.tsx        — 52×28px switch, 44px hit area
  Input.tsx         — text input with label, error, hint
  Select.tsx        — styled dropdown, 44px tall
  TextArea.tsx      — multiline Input
  Modal.tsx         — sizes: sm, md, lg, xl, full
                       mobile: bottom-sheet variant (items-end)
  Sheet.tsx         — mobile bottom sheet (new)
  Tabs.tsx          — shared tab bar (URL-synced or state-synced)
  Card.tsx          — interactive variant (onClick, hover)
  Badge.tsx         — status/count badges
  Tooltip.tsx       — hover/focus info
  ContextMenu.tsx   — right-click / long-press menu
  Drawer.tsx        — side panel for settings, filters
  EmptyState.tsx    — consistent empty/loading/error
  ProgressBar.tsx   — with aria-label, indeterminate, paused states
```

### 8.2 Design token fixes

- Fix `ErrorBoundary` broken `--color-surface-hover` → use `--color-surface-3`
- Fix `ErrorBoundary` `text-white` → use `--color-accent-contrast`
- Consolidate `ErrorCard`/`SuccessCard`/`WarningCard` → one component
  with `tone` prop
- Fix `EmptyState` doc/code mismatch (72vh vs 55vh)
- Fix `ConfirmDialog` prompt input to use `.input` class + global focus ring

### 8.3 Icon sizes — standardize

| Usage | Size |
|-------|------|
| Inline with text | 14px |
| Button icon | 18px (sm), 20px (md) |
| Card/Page header | 22px |
| Empty state hero | 40px |
| Status bar | 14px |
| Modal/Toast close | 20px (in a 44px IconButton) |

### 8.4 Spacing system

Use Tailwind's scale consistently:
- Component padding: `p-4` (16px) for cards, `p-3` (12px) for dense rows
- Section gaps: `gap-6` (24px) between major sections
- List row height: `min-h-[44px]` for touch, `min-h-[36px]` for dense
- Content max-width: `max-w-7xl` (80rem) for wide screens

---

## 9. Mobile / Android Redesign

### 9.1 Bottom navigation (primary)

> ⚠️ **SUPERSEDED (R10).** The bottom-nav pattern is refined in
> `v5-mobile-design.md` (responsive tiers xs/sm/md/lg/xl, top-bar chip layout,
> drawer, hardware back-button stack, Scoped Storage wizard, keep-awake policy,
> share-to-app intent filters). Haptic vocabulary — originally sketched here as
> 3 events — is canonical at **4 events** (tap / selection / confirm / danger)
> in `v5-cross-cutting-concerns.md` §6.6 and `v5-mobile-design.md` §4.4.

5 tabs at the bottom of the screen:
```
┌────┬────┬────┬────┬────┐
│ 🏠 │ 🎮 │ 📁 │ ⚙️ │ 📋 │
│Home│Game│File│Con │Task│
└────┴────┴────┴────┴────┘
```
- 56px tall + `env(safe-area-inset-bottom)` padding
- Each tab: 44×44px minimum touch target
- Active tab: accent color + filled icon
- Haptic feedback on tab change (Android Vibration API)

### 9.2 Drawer for secondary screens

Hamburger (☰) in top bar opens a drawer:
```
┌─────────────────────┐
│ Send Payload        │
│ Logs                │
│ Audit Log           │
│ Bug Report          │
│ What's New          │
│ FAQ / Help          │
│ About               │
└─────────────────────┘
```
- Slides in from left (or right — configurable for RTL)
- Scrim tap closes
- Max width: 85vw

### 9.3 Mobile-specific patterns

- **Game Hub on mobile**: full-screen view with swipeable tabs
  (Overview ←→ Cheats ←→ Saves ←→ Media)
- **File browser on mobile**: single-pane (no dual-pane). Navigation
  via breadcrumbs + back gesture.
- **Tasks on mobile**: single-column list, expandable cards
- **Saves row**: kebab menu (⋮) instead of 4 inline buttons
- **Fan curve editor**: touch-friendly drag points on a chart
- **Command palette**: full-screen modal on mobile (not 560px fixed)
- **Profile avatar crop**: pinch-to-zoom instead of pixel-precise crop

### 9.4 Android WebView optimizations

- Already have: `text-size-adjust: 100%`, `min-width: 0`, `overflow-wrap`
- Already have: scoped-storage path picker (`LocalPathPicker`)
- Already have: `env(safe-area-inset-*)` in 4 locations
- Add: `overscroll-behavior: contain` on scrollable lists (prevent
  pull-to-refresh interference)
- Add: `touch-action: manipulation` on buttons (remove 300ms delay)
- Add: `-webkit-tap-highlight-color: transparent`

---

## 10. Visual Design Language

> ⚠️ **SUPERSEDED (R12).** The canonical visual design language — 4-layer
> token hierarchy, typography scale, the refined 4-theme color system, the
> elevation/z-index ramp, motion language, iconography standard, density
> modes, and glassmorphism — lives in `v5-accessibility-design-system.md`
> §11-§18. This section is retained only for the elf-arsenal inspiration
> narrative.

### 10.1 Inspired by elf-arsenal, adapted for desktop + mobile

**What to borrow from elf-arsenal:**
- **Spotlight panel**: When hovering a game tile, show a large backdrop
  with blurred game art + title + quick actions. Beautiful, immersive.
- **Glassmorphism header**: `backdrop-filter: blur(18px) saturate(140%)`
  on the top bar — modern, lets content scroll under it gracefully.
- **Radial-gradient background**: Subtle colored glows in corners instead
  of flat black. Gives depth without distraction.
- **Card hover lift**: `transform: translateY(-3px)` + accent glow ring
  on tile hover. Tactile, responsive feel.
- **Settings categorization**: Auto-group settings by keyword rules.
  First-match-wins classification into categories.

**What NOT to borrow:**
- Their carousel (too TV-centric, we're a desktop/mobile app)
- Their raw HTML/CSS approach (we have React + Tailwind)
- Their cursor-snap hack (PS5-controller-specific, not relevant)

### 10.2 Color tokens (refined from current 4 themes)

Keep the 4 existing themes (Dark, Light, OLED, Rose) but add:

```css
:root {
  /* NEW: semantic elevation tokens */
  --elevation-0: transparent;
  --elevation-1: 0 1px 3px rgba(0,0,0,0.12);
  --elevation-2: 0 4px 12px rgba(0,0,0,0.15);
  --elevation-3: 0 8px 24px rgba(0,0,0,0.20);
  --elevation-4: 0 16px 48px rgba(0,0,0,0.25);

  /* NEW: glassmorphism */
  --glass-bg: rgba(15, 20, 35, 0.85);
  --glass-blur: 18px;

  /* NEW: accent glow */
  --accent-glow: 0 0 24px var(--accent-glow-rgba);
}
```

### 10.3 Typography

- System font stack (already used): `-apple-system, BlinkMacSystemFont, "Segoe UI"...`
- Base size: 18px (already set, with `--ui-base-size` for user control)
- Scale:
  - Page title: 2xl (24px)
  - Section title: lg (18px) semibold
  - Card title: base (16px) semibold
  - Body: base (16px) / sm (14px)
  - Caption/mono: xs (12px)
- `font-variant-numeric: tabular-nums` (already set — keep for counters)

### 10.4 Animation

- Card hover: `transition: transform 0.18s ease, box-shadow 0.2s ease`
- Modal open: `scale(0.95) → 1.0` + fade, 200ms
- Drawer: slide-in 220ms (already have `anim-drawer`)
- Toast: slide-up + fade, 180ms
- Loading: shimmer skeleton (already have `anim-skeleton`)
- Respect `prefers-reduced-motion` (already implemented)

---

## 11. Migration Path

### 11.1 No breaking changes for users

- **Settings**: all existing localStorage keys preserved
- **Console roster**: preserved
- **Activity history**: preserved
- **Routes**: old routes (`/cheats`, `/saves`, etc.) redirect to new locations
  (e.g., `/cheats` → `/games/CUSA00506/cheats` or `/games?tab=cheats`)

### 11.2 API backward compat

- All v4 endpoints remain functional
- New unified endpoints (`/api/ps5/telemetry/stream`, unified jobs) are
  additive
- Old `fs/op-status`, `pkg/install/status` continue to work — internally
  they query the unified job system

### 11.3 Progressive rollout

The redesign can ship in phases (see below). Each phase is independently
shippable — users see improvements incrementally.

---

## 12. Implementation Phases

> ⚠️ **SUPERSEDED (R5, R13).** The phase plan here is **stale and its IDs
> collide** with the canonical plan. Specifically: Phase 5.1 step 2 below says
> "Build the 6-tab Game Hub" — the canonical Game Hub has 8 tabs; Phase 5.2
> "Unified Tasks + Telemetry" uses letters that collide with the canonical
> 5.2-a..e. The canonical, non-colliding phase plan — covering all 5 primary
> tabs + Game Hub 8-tab build, with consistent letter suffixes — lives in
> `v5-cross-cutting-concerns.md` §12. Sub-docs (file-browser §18, home-console
> §24, mobile §17) cross-reference that canonical plan.

### Phase 5.0 — Foundation (2-3 weeks)

**Goal**: Shared component library + design tokens, no navigation change yet.

1. Create all shared primitives (Section 8.1)
2. Fix all design bugs (Section 1)
3. Fix touch targets across all existing components
4. Standardize icon sizes
5. Consolidate ErrorCard/SuccessCard/WarningCard → one component
6. Fix ErrorBoundary tokens
7. Add glassmorphism header + radial-gradient background
8. Write migration guide for screens to adopt new components

**Deliverable**: v5.0 release. Same navigation, better components. All
existing screens look more polished and are touch-friendly.

### Phase 5.1 — Navigation Restructure (2-3 weeks)

**Goal**: 5-tab navigation + Game Hub.

1. Build new `AppShell` with 5-tab sidebar (desktop) + bottom nav (mobile)
2. Build Game Hub component with 6 tabs (Overview/Cheats/Saves/Media/Patches/Activity)
3. Merge Library + Installed Apps → Games tab
4. Move Cheats, Saves, SDK Changer, TMDB into Game Hub
5. Merge Hardware + Processes + Fan Curve → Console tab sections
6. Merge FTP + SMB + Search + Disk Usage + Volumes → Files tab modes
7. Build Drawer for secondary screens
8. Add route redirects for old paths

**Deliverable**: v5.1 release. New navigation, Game Hub. Users immediately
feel the workflow improvement.

### Phase 5.2 — Unified Tasks + Telemetry (2-3 weeks)

**Goal**: One task timeline, one telemetry stream.

1. Engine: route FS ops through unified job system
2. Engine: route PKG install through unified job system
3. Engine: route backup snapshot/restore through unified job system
4. Engine: add `/api/ps5/telemetry/stream` SSE endpoint
5. Client: build Tasks tab with unified timeline
6. Client: subscribe to telemetry stream, replace polls
7. Client: add live status bar at bottom
8. Client: add Statistics sub-tab

**Deliverable**: v5.2 release. One timeline for everything. No polling
storms. Live status bar always visible.

### Phase 5.3 — Spotlight + Polish (1-2 weeks)

**Goal**: Visual wow factor.

1. Add Spotlight panel to Games tab (hover/focus a tile → large backdrop
   with blurred art + title + quick actions)
2. Card hover lift + accent glow
3. Command palette: add actions (not just screen navigation)
4. Mobile: swipe gestures, pull-to-refresh, haptic feedback
5. Onboarding: update first-run wizard for new navigation
6. Update all empty/loading/error states for consistency
7. Accessibility audit: keyboard nav, screen reader, focus traps

**Deliverable**: v5.3 release. Beautiful, polished, accessible.

### Phase 5.x — Future (ongoing)

- Docker web UI (no Tauri) — the Files/Games/Tasks tabs work in a browser
- Cloud sync (backup saves to cloud storage)
- Multi-console dashboard (view telemetry from all PS5s simultaneously)
- Plugin system (third-party cheat providers, custom actions)
- Game artwork community (share TMDB mappings)

---

## Appendix A: Lessons from elf-arsenal

| Pattern | Worth borrowing? | How |
|---------|-----------------|-----|
| Settings auto-categorization by keyword rules | ✅ | Classify settings sections into 5 categories automatically |
| `/api/state` single endpoint for all toggles | ❌ | We have too many stateful resources; keep granular APIs |
| Glassmorphism header + radial gradient bg | ✅ | Adopt for visual polish |
| Card hover lift + accent glow | ✅ | Adopt for game tiles |
| Spotlight panel with blurred game art | ✅ | Adopt for Games tab hero |
| Carousel navigation | ❌ | Too TV-centric; we use grid |
| Cursor-snap overlays | ❌ | PS5-controller-specific hack |
| `<details>` collapsible settings sections | ✅ | Already use similar pattern; keep |
| Gamepad key handling with debounce | ❌ | Desktop/mobile app, not TV |
| FPKG-Guard folder locking | N/A | We don't have this feature |
| `?_=Date.now()` cache busting | ❌ | Tauri webview doesn't have this issue |
| bfcache reload on `pageshow` | ❌ | Same as above |

## Appendix B: Current Screen → New Location (detailed)

> ⚠️ **SUPERSEDED.** The detailed screen-mapping — including the canonical
> orphaned-API → UI home table, and what does NOT move into Files (UFS fsck
> and app.db query deep-link to Console → Tools per C5/R1) — lives in
> `v5-file-browser-redesign.md` Appendix B and Appendix C.

| Screen (v4) | Lines | New tab | Section/mode | Notes |
|-------------|-------|---------|-------------|-------|
| Dashboard (358) | → | Home | — | Becomes the Home tab content |
| Connection (~200) | → | Home | "Connect" card | First-run wizard unchanged |
| Upload (~300) | → | Files | "Upload" action | Modal or sidebar panel |
| InstallPackage (1254) | → | Games | "Install PKG" button | Modal/drawer for source selection |
| Library (~500) | → | Games | — | Merged with Installed Apps |
| InstalledApps (1132) | → | Games | — | Merged with Library |
| FileSystem (2715) | → | Files | "PS5" mode | Core browser |
| Search (~400) | → | Files | "Search" mode | Toggle within browser |
| Volumes (~150) | → | Files | Sidebar selector | Volume list in sidebar |
| DiskUsage (~400) | → | Files | "Disk Usage" mode | Toggle within browser |
| Hardware (~500) | → | Console | "Sensors" section | |
| Processes (569) | → | Console | "Processes" section | |
| FanCurve (~350) | → | Console | "Thermal" section | Merged with sensor view |
| RemotePlay (~200) | → | Console | "Remote Play" section | |
| Notifications (~200) | → | Console | "Notifications" section | |
| Profile (~400) | → | Console | "Profile" section | Or header avatar click |
| FTPServer (~200) | → | Console | "Network" section | Toggle card |
| SmbBrowser (~400) | → | Files | "SMB" mode | |
| NanoDns (~200) | → | Console | "Network" section | |
| Shell (~300) | → | Console | "Shell" section | Or ⌘K action |
| Cheats (416) | → | Game Hub | "Cheats" tab | Per-game view |
| Saves (1048) | → | Game Hub | "Saves" tab | Per-game view |
| GameActivity (~300) | → | Game Hub | "Activity" tab | Per-game view |
| SdkChanger (~400) | → | Game Hub | "Patches" tab | Per-game view |
| Tmdb (~400) | → | Game Hub | "Artwork" action | Auto on install |
| FwSpoof (~200) | → | Console | "Firmware" section | |
| Backup (~400) | → | Console | "Backup" section | Smart suggestions |
| Activity (~500) | → | Tasks | "Active/Recent" | |
| Stats (~300) | → | Tasks | "Statistics" | |
| Logs (~200) | → | Drawer | "Logs" | |
| AuditLog (~300) | → | Drawer | "Audit Log" | |
| BugReport (~300) | → | Drawer | "Bug Report" | |
| Payloads (~600) | → | Home/Drawer | "Send Payload" card | |
| Screenshots (~400) | → | Game Hub | "Media" tab | Per-game filter |
| Videos (~400) | → | Game Hub | "Media" tab | Per-game filter |
| FAQ (~200) | → | Drawer | "Help" | |
| About (~100) | → | Drawer | "About" | |
| Settings (~500) | → | Header ⚙ | Settings drawer | |
| Changelog (~200) | → | Drawer | "What's New" | |
| FirstRun (~400) | → | Onboarding | Unchanged | |

**Total: 40 screens → 5 tabs + 1 drawer + 1 Game Hub.**

---

## Appendix C: New Component API Sketches

> ⚠️ **SUPERSEDED (R12, R17, R18).** The API sketches here are outdated:
> `<Tabs urlParam="tab">` was replaced by the `TabbedShell` wrapper pattern
> (variant/ariaLabel props, no urlParam); `Spotlight` is missing `onClose`,
> `disabled`, and `disabledReason`. The canonical component APIs — all ~28
> primitives with full prop signatures, ARIA contracts, and keyboard behavior
> — live in `v5-accessibility-design-system.md` §19.

### Button

```tsx
<Button variant="primary" size="md" leftIcon={<Upload/>} loading>
  Upload
</Button>
// sm=36px, md=44px (default), lg=52px
```

### IconButton (new)

```tsx
<IconButton aria-label="Close" onClick={...}>
  <X/>
</IconButton>
// Always 44×44px, icon centered
```

### Toggle (new, replaces raw checkbox for boolean state)

```tsx
<Toggle checked={on} onChange={setOn} label="Auto-apply patches"/>
// 52×28px switch, 44px hit area
```

### Checkbox (new, for multi-select)

```tsx
<Checkbox checked={sel} onChange={setSel} label="Select all"/>
// 24px visual box, 44px hit area
```

### Tabs (new, shared)

```tsx
<Tabs tabs={[
  {id:"overview", label:"Overview", icon:Info},
  {id:"cheats", label:"Cheats", icon:Gamepad2, badge:"12"},
  {id:"saves", label:"Saves", icon:Save},
]} value={tab} onChange={setTab}/>
// URL-synced variant: <Tabs urlParam="tab" .../>
```

### Modal (improved)

```tsx
<Modal open={open} onClose={...} size="md" variant="center|sheet">
  {/* sheet = bottom-sheet on mobile */}
</Modal>
```

### Spotlight (new, for Games tab hero)

```tsx
<Spotlight game={hoveredGame || selectedGame}
  actions={[
    {label:"Launch", icon:Play, onClick:launch, primary:true},
    {label:"Cheats (12)", icon:Gamepad2, onClick:openCheats},
    {label:"Saves", icon:Save, onClick:openSaves},
  ]}
/>
```

---

*This document is a living plan. Update as implementation reveals new
constraints or opportunities.*
