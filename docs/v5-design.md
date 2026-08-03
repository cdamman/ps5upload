# ps5upload v5.0 — Master Design Specification

> **Status:** PLANNING — no v5 code written yet. v4.3.2 is the current release.
>
> **Authority:** This is the **canonical, build-ready** v5 specification. It
> consolidates eight prior design docs into one self-contained document. All
> cross-document conflicts were resolved in the consistency review (loops
> 81-90); the register is preserved at `docs/v5-consistency-review.md`. Where
> this master and a sub-doc disagree, **this master is authoritative**. The
> sub-docs remain as long-form references (full mockups, edge-case
> walkthroughs) for implementers.
>
> **Sub-doc index (deep dives):**
> | Doc | Scope |
> |-----|-------|
> | `v5-design-original.md` | The first v5 draft — retained for historical context only. |
> | `v5-home-console-redesign.md` | Home tab + Console tab full mockups, 12 Console sections. |
> | `game-hub-revised-design.md` | Game Hub 8-tab design, cheats/saves/media/DLC deep dives. |
> | `v5-file-browser-redesign.md` | Unified File Browser — locations, views, batch ops, clipboard. |
> | `v5-task-system.md` | Task envelope, lifecycle, retry, pipelines, alerts, telemetry. |
> | `v5-cross-cutting-concerns.md` | Routes, offline, error policy, state ownership, permissions, phases. |
> | `v5-mobile-design.md` | Android/mobile platform layer, 20 mobile gaps resolved. |
> | `v5-accessibility-design-system.md` | WCAG 2.2 AA conformance, visual language, 28 component primitives. |
> | `v5-consistency-review.md` | 33 cross-doc findings + resolutions (all applied). |

---

## Table of Contents

**Part I — Foundations**
- 1. What's Wrong Today (v4.3.2)
- 2. Design Principles
- 3. Information Architecture: 5 Tabs + Drawer
- 4. Routes & URL Grammar

**Part II — The Five Tabs**
- 5. Home Tab
- 6. Games Tab & Game Hub
- 7. Files Tab
- 8. Console Tab
- 9. Tasks Tab

**Part III — Cross-Cutting Systems**
- 10. Unified Task System (internals)
- 11. Telemetry Stream
- 12. Error, Empty & Toast Policy
- 13. Offline & Recovery
- 14. Multi-Console Semantics
- 15. Concurrency & Conflict Resolution
- 16. Permissions & Capability Model
- 17. Deep-Linking & Navigation

**Part IV — Platform Layer**
- 18. Mobile / Android
- 19. Desktop Specifics

**Part V — Design System**
- 20. Accessibility Conformance (WCAG 2.2 AA)
- 21. Visual Design Language
- 22. Component Primitive Library
- 23. Accessibility Settings Panel

**Part VI — Delivery**
- 24. Migration Path
- 25. Implementation Phases
- 26. Gap-to-Section Indices

**Appendices**
- A. v4 Screen → v5 Home (full consolidation map)
- B. Orphaned API → UI home
- C. Frame type allocation (FTX2)
- D. State ownership map
- E. Glossary

---

# Part I — Foundations

## 1. What's Wrong Today (v4.3.2)

v4 is a capable but structurally exhausted toolset. The features work; the
experience around them doesn't. Six structural problems motivate v5:

### 1.1 Too many destinations, no hierarchy
**41 screens**, all flat under one AppShell, organized into 6 sidebar sections
containing **40 sidebar items**. There is no "home" or "dashboard" — the app
opens to whatever was last visited. Users navigate by remembering which of 40
items to click, not by recognizing a small set of destinations.

**Symptom:** Only **5 of 41 screens** contain any outbound navigation link.
Every other screen is a dead end — the user must use the sidebar to go
anywhere.

### 1.2 Heavy redundancy across screens
- **Library** and **InstalledApps** are ~90% the same view (both list games).
- **Screenshots** and **Videos** are the same surface split in two.
- **4 separate history surfaces**: Activity, AuditLog, Logs, GameActivity.
- **DiskUsage** is a standalone screen that should be a view in the file browser.
- **3 parallel job/status systems** (`jobs` map + SSE for uploads;
  `fs/op-status` for filesystem ops; `pkg/install/status` for installs) with
  no unified model, no cross-references, no shared retry semantics.

### 1.3 Touch targets fail WCAG 2.5.5 (AAA) and 2.5.8 (AA) everywhere
`Button` default size is `sm` (~28px). Interactive icon-only controls
throughout the app are 20-28px. The `@media (pointer: coarse)` rule in
`index.css` is a partial mitigation but most controls fail the 44×44 AAA
target and many fail the 24×24 AA floor.

### 1.4 No accessibility story
- 100+ raw `<input>` elements, 30+ raw `<select>`s, 40+ raw checkboxes, 50+
  inline badge spans across 41 screens — none use shared primitives with
  consistent ARIA.
- No app-level Toaster (only PS5-side `toastPush`).
- CommandPalette missing combobox ARIA. OverflowMenu missing arrow-key nav.
- No screen reader testing has been performed.
- ErrorBoundary references nonexistent CSS tokens (`--color-bg`,
  `--color-surface-hover`).

### 1.5 Polls everywhere, no reactive core
The Dashboard polls 6+ endpoints on mount. The Tasks tab polls. The Fan Curve
screen polls. There's no shared telemetry stream — every screen grabs its own
data on its own cadence. Result: battery drain on mobile, redundant network
traffic, inconsistent latency across screens.

### 1.6 Mobile is bolted on, not designed
Bottom nav was added late; the back-button behavior is "default Webview",
which is wrong for a multi-modal app. No Scoped Storage wizard, no keep-awake
policy, no share-to-app intent filter, no haptic vocabulary. The Drawer is
hard to reach on phones. Touch targets fail everywhere.

---

## 2. Design Principles

1. **Five destinations, not forty.** Home, Games, Files, Console, Tasks.
   Anything else lives in the Drawer or a contextual surface.
2. **Game-centric workflows.** The Game Hub is the heart of the app —
   everything about one game lives behind one URL (`/games/:title_id`).
3. **One task model.** Every long-running operation is a `Task`. One
   envelope, one lifecycle, one retry policy, one history.
4. **One telemetry stream.** A single SSE feed replaces 6+ polls. Screens
   subscribe; they don't fetch.
5. **Touch-first, keyboard-complete.** Every interactive element ≥ 44×44px.
   Full keyboard nav with WAI-ARIA patterns. WCAG 2.2 AA conformance target.
6. **Mobile is a first-class target, not a shrink.** Responsive tiers,
   bottom nav, hardware back-button stack, Scoped Storage, haptics.
7. **Deep-links are the contract.** Every screen state is reachable by URL.
   Path = identity; query = view.
8. **Don't ship features twice.** Redundant screens merge. DiskUsage is a
   view. Library + InstalledApps are one tab. History is one timeline.

---

## 3. Information Architecture: 5 Tabs + Drawer

### 3.1 The five primary tabs

| Tab | Icon | Route | Purpose |
|-----|------|-------|---------|
| **Home** | `LayoutDashboard` | `/` | Dashboard: connection status, payloads, running games, quick actions, recent activity, recommendations. |
| **Games** | `Gamepad2` | `/games` | Game library (merged Library + InstalledApps). Click a tile → Game Hub at `/games/:title_id`. |
| **Files** | `FolderTree` | `/files` | Unified file browser: PS5, FTP, SMB, Local as **locations**; list/grid/tree/disk-usage as **view modes**. |
| **Console** | `Cpu` | `/console` | System control: thermal, power, processes, network, firmware, notifications, profile, remote play, backup, shell, alerts, tools. |
| **Tasks** | `Activity` | `/tasks` | Unified task timeline (active + history). Telemetry dashboard, statistics, automation. |

### 3.2 Global header (44px, glassmorphism)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [≡] ps5upload   [PS5 Pro ▾]              [⌘K]  [🔔 2]  [⚙]  [👤]            │
└────────────────────────────────────────────────────────────────────────────┘
```
- **Hamburger (≡)** — opens the Drawer (§3.4).
- **Console selector** — roster picker, always visible. Switching console
  triggers the §14 semantics (preserve URL identity, refresh data).
- **⌘K** — Command Palette (§17.5).
- **🔔 Notification bell** — count badge (unread + active alerts). Click →
  Console → Notifications.
- **⚙ Settings** — opens Settings drawer (not a tab).
- **👤 Avatar** — click → Console → Profile.

**Contextual header actions** (tab-specific, inserted before global icons):
- Home: "Send payload" button (primary)
- Games: "Install PKG" button
- Files: "Upload" button
- Console: "FTP on/off" toggle
- Tasks: "Pause all" / "Resume all" (if any runnable)

### 3.3 Status bar (28px, desktop only — collapses to header chips on mobile)

`[● connected] [78°C] [fan 42%] [22% used] [↑ 14 MB/s] [v9.60]`

Shows: connection dot, temperature, fan duty, disk usage, transfer rate,
firmware version. Driven by the telemetry stream (§11). Hidden on xs/sm/md —
those values become header chips (`[🔥 78°]`).

### 3.4 Drawer contents (canonical)

The Drawer is the home for **secondary** destinations — anything that isn't
one of the 5 primary tabs but still needs to be reachable. Opened via
hamburger or `Alt+D`.

| Item | Behavior |
|------|----------|
| **What's New** (Changelog) | Auto-opens on first launch after an upgrade; reachable here afterwards. |
| **Settings** | Theme, paths, language, accessibility, tasks, advanced. The Settings drawer is split into sub-panels (§24.2). |
| **Help / FAQ** | In-app FAQ + bug report. |
| **About** | Version, licenses, credits. |
| **Roster** | Multi-console management (add/edit/remove PS5s). |

**NOT in the Drawer** (these moved): Payloads (now a Home modal, §5.4),
AuditLog (now Tasks → History, §10.7), Logs (now Tasks → History), Activity
(now Tasks → History), BugReport (now in Help).

### 3.5 Desktop layout (lg / xl — left rail + content)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [≡] ps5upload   [PS5 Pro ▾]              [⌘K]  [🔔 2]  [⚙]  [👤]            │
├──────┬─────────────────────────────────────────────────────────────────────┤
│ 🏠   │                                                                     │
│ 🎮   │                                                                     │
│ 📁   │                     (active tab content)                            │
│ 🖥    │                                                                     │
│ ⚙    │                                                                     │
├──────┴─────────────────────────────────────────────────────────────────────┤
│ [● connected] [78°C] [fan 42%] [22% used] [↑ 14 MB/s] [v9.60]               │
└────────────────────────────────────────────────────────────────────────────┘
```
- **Left rail:** 56px wide, icon-only, vertically centered. Tooltip on hover
  shows label + keyboard shortcut (Alt+1..5). Collapsible to 0-width;
  preference persists per device.
- **Content:** max-width 1440px, centered, with 24px gutters at lg / 32px at
  xl.
- **Touch targets:** WCAG 2.5.5 AAA target = 44×44 (project default). AA
  floor = 24×24 (WCAG 2.5.8) — only used for dense data-grid cells where 44px
  would harm usability, never as the default.

### 3.6 Mobile layout (xs / sm / md — bottom nav + top bar)

```
┌────────────────────────────────────────────┐
│ [≡]   [PS5 Pro ▾]    [🔥 78°]  [⌘K] [⚙]    │  ← top bar (44px + safe-area)
├────────────────────────────────────────────┤
│                                            │
│             (active tab content)           │
│                                            │
│                                            │
├────────────────────────────────────────────┤
│  🏠    🎮    📁    🖥    ⚙                  │  ← bottom nav (56px + safe-area)
└────────────────────────────────────────────┘
```
- **Bottom nav:** 56px tall + safe-area-inset-bottom. 5 items. Hardware back
  button (Android) wired through an explicit `backStack` (§18.6).
- **Top bar:** 44px + safe-area-inset-top. Console selector center; ⌘K and ⚙
  right. Status-bar values collapse to a single temperature chip.
- **Drawer:** opens as a bottom sheet (peek-then-expand) on mobile, not a
  left-side drawer.
- **Touch targets:** 44×44 minimum enforced everywhere via component
  primitives (§22).

### 3.7 Responsive tiers

| Tier | Width | Layout |
|------|-------|--------|
| `xs` | <480px | Bottom nav, single column, full-screen modals. |
| `sm` | 480-767px | Bottom nav, single column, full-screen modals. |
| `md` | 768-1023px | Bottom nav, optional two-column (Game Hub side panel), modals as bottom sheets. |
| `lg` | 1024-1535px | Left rail + content, two-column where applicable. |
| `xl` | ≥1536px | Left rail + wide content, three-column where applicable. |

`useResponsiveTier()` hook drives conditional rendering; never use
`isMobile()` alone (too coarse).

---

## 4. Routes & URL Grammar

### 4.1 Grammar rules

1. **Path = identity.** The resource being viewed is in the path.
   `/games/CUSA00506` is *this specific game*.
2. **Query = view.** How to display the resource is in the query.
   `?tab=cheats`, `?view=grid`, `?section=thermal`.
3. **Modal state can be URL-encoded** (§17.4) when the modal is the primary
   reason for the visit (e.g. `/console?section=tools&tool=ufs-fsck`).

### 4.2 Route table

| Route | Tab | Notes |
|-------|-----|-------|
| `/` | Home | Dashboard widgets. |
| `/games` | Games | Grid of all titles. Query: `?origin=all\|installed\|library\|favorites`, `?sort=`, `?filter=`, `?view=grid\|list`. |
| `/games/:title_id` | Game Hub | 8 tabs via `?tab=overview\|cheats\|saves\|media\|add-ons\|updates\|storage\|play-time`. |
| `/files` | Files | Query: `?loc=<locationId>&path=<urlencoded>&view=list\|grid\|tree\|disk-usage&select=<id1,id2>&search=<q>`. |
| `/console` | Console | 12 sections via `?section=thermal\|power\|processes\|network\|firmware\|notifications\|profile\|remote-play\|backup\|shell\|alerts\|tools`. |
| `/tasks` | Tasks | Query: `?view=active\|history\|telemetry\|stats\|automation&task=<id>` (jump to task row). |
| `/settings` (Drawer) | Settings | Modal-via-URL. Sub-panels via `?panel=general\|accessibility\|paths\|...`. |
| `/help` (Drawer) | Help/FAQ | |
| `/about` (Drawer) | About | |
| `/roster` (Drawer) | Roster | Multi-console management. |

### 4.3 URL grammar cheat-sheet

| Want to express | Mechanism | Example |
|-----------------|-----------|---------|
| Which game | path | `/games/CUSA00506` |
| Which Game Hub tab | query | `?tab=cheats` |
| Which Files location | query | `?loc=ps5-ssd` |
| Which Files path | query | `?path=%2Fdata%2F` (urlencoded) |
| Which Files view | query | `?view=grid` |
| File selection | query | `?select=id1,id2` |
| Which Console section | query | `?section=thermal` |
| Which Tasks view | query | `?view=history` |
| Specific task | query | `?task=01J...` or ⌘K `#01J...` |
| Modal open | query | `?modal=send-payload` |
| Search | query | `?search=astro` |

---


# Part II — The Five Tabs

## 5. Home Tab

**Route:** `/`. **Purpose:** the dashboard — at-a-glance status of the
connected PS5 plus the most likely next actions. Zero polls; everything comes
from the telemetry stream (§11) and reactive stores.

### 5.1 Layout (desktop, 2-column)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌─── Connection ───────────────────┐  ┌─── Continue playing ──────────────┐ │
│ │ ● PS5 Pro · FW 9.60              │  │ 🎮 Astro's Playroom               │ │
│ │ 18.2 °C ↑ fan 42%   [Eject]      │  │ Last played 2h ago                │ │
│ │ 2.1 TB free / 4 TB               │  │ [▶ Resume]                        │ │
│ │ [⏻ Power]  [📥 Send payload…]    │  └────────────────────────────────────┘ │
│ └────────────────────────────────────┘                                     │
│ ┌─── Quick actions ────────────────┐  ┌─── At a glance ────────────────────┐ │
│ │ [⬆ Upload PKG]   [📥 Install]    │  │ 142 games (138 installed)          │ │
│ │ [💾 Backup saves] [📡 Start FTP]  │  │ 3 tasks running, 12 queued         │ │
│ │ [⚙ Console]      [📋 Tasks]      │  │ Last backup: 3 days ago            │ │
│ └────────────────────────────────────┘  │ 2 alerts (1 warn, 1 critical)      │ │
│                                         └────────────────────────────────────┘ │
│ ┌─── Recent activity ─────────────────────────────────────────────────────┐  │
│ │ 14:22  Installed CUSA01234 (v1.02 patch)             ✓                   │  │
│ │ 13:55  Backup snapshot "pre-FW12" completed          ✓                   │  │
│ │ 13:40  Cheats downloaded: GoldHEN for CUSA00506      ✓                   │  │
│ │ 13:01  Upload failed: /data/big.pkg (network)        ↻ Retry             │  │
│ └────────────────────────────────────────────────────────────────────────────┘ │
│ ┌─── Recommended ──────────────────┐  ┌─── Notifications ──────────────────┐ │
│ │ 💡 Back up 23 games with unsaved  │  │ ⚠ Thermal alert: 86°C (5m ago)     │ │
│ │    progress.                      │  │ 📥 Firmware 10.02 available        │ │
│ │ 💡 8 games have update available  │  │ 🔔 PSN friend request              │ │
│ └────────────────────────────────────┘  └────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 The seven widgets

| Widget | Source | Interactivity |
|--------|--------|---------------|
| **Connection** | Telemetry stream (§11) | Power menu, Eject, Send payload (modal §5.4). |
| **Continue playing** | `gameActivityGet` (recent) + telemetry (running title) | Resume button → Console → Remote Play OR ⌘K "Launch <title>". |
| **Quick actions** | Static config + capability gates | Each button is a deep-link to its destination tab. |
| **At a glance** | Reactive stores (games count, tasks, alerts) | Click any stat → relevant tab. |
| **Recent activity** | Unified history store (§10.7) | Click any row → the task or game. Failed rows show Retry. |
| **Recommended** | Heuristics: unbacked saves, pending updates, never-played library titles | Each suggestion is actionable. |
| **Notifications** | Console → Notifications store | Click → Console → Notifications. |

### 5.3 Connection card detail

**Connected state:** console name, firmware, temperature trend (sparkline),
fan duty, free space, connection uptime. Buttons: **Eject disc** (if disc
present), **Power** menu (standby / restart / power off — destructive ones
confirm), **Send payload** (opens modal §5.4).

**Disconnected state:** large empty-state hero with **Send payload** as the
primary CTA, plus "Add a console" (→ Roster) and "Help connecting" (→ Help).
No telemetry-driven content shown.

### 5.4 Send-payload modal

Opened via Connection card button, ⌘K action, or "Install PKG" contextual
action. 3-step flow:

1. **Choose payload** — catalog (USB autoloaded, recent, favorites) or Browse.
2. **Choose options** — thread pinning, FTP-port reservation, hide-FTP flag,
   optional post-tasks (auto-install a PKG, start FTP, launch a game).
3. **Confirm + send** — progress is a Task (visible in Tasks tab).

This modal replaces the v4 Payloads screen entirely. See §5.4 of the
Home/Console deep-dive for full mockups.

### 5.5 First-run / empty states

First launch opens a 4-step wizard: (1) Add a console (roster entry), (2)
Connect + send payload, (3) Pick default paths, (4) (Android only) Scoped
Storage grant. The wizard is resumable; on cancel, Home shows the disconnected
hero.

### 5.6 Poll elimination

The v4 Dashboard polled 6+ endpoints on mount. The v5 Home polls **zero**.
Every widget subscribes to the telemetry stream (§11) or reads a reactive
store that some other screen has already populated. Initial mount fetches a
single "snapshot" endpoint that seeds all stores; everything after is SSE.

---

## 6. Games Tab & Game Hub

**Routes:** `/games` (grid) and `/games/:title_id` (hub).

### 6.1 Games grid

Single grid aggregating **Library + InstalledApps** (the v4 redundancy). One
endpoint `GET /api/games` returns a unified list with origin flags.

**Filters** (query-driven): origin (`all | installed | library | favorites`),
sort (name / last-played / size / install-date), search. **View modes:**
grid (default, with cover art) / list (compact).

**Multi-select** (long-press on mobile, shift-click on desktop): batch install,
batch back-up saves, batch uninstall, batch fetch TMDB metadata, add to
collection.

**Favorites & collections:** per-user tags. Collections are user-named
("Kids games", "Co-op night"); a game can be in multiple collections.

### 6.2 Game Hub — 8 tabs

The Game Hub is the heart of the app: everything about one game lives behind
one URL. Opened by clicking a tile, via ⌘K (`game <name>`), or via deep-link.

**Header (always visible):**
```
┌────────────────────────────────────────────────────────────────────────────┐
│ [← Back]  [🖼] Astro's Playroom      CUSA00506 · FW 9.60 · 3.2 GB           │
│           [▶ Launch ▾] [▶ Launch w/ cheats ▾] [⋯]                          │
└────────────────────────────────────────────────────────────────────────────┘
   Overview · Cheats · Saves · Media · Add-ons · Updates · Storage · Play Time
```
- Launch button split: plain launch, launch-with-cheats (with profile picker
  + last-known-good, §6.3.1).
- ⋯ menu: uninstall (with cleanup), reveal in Files, copy title_id, hide
  from grid.
- Tabs use the `Tabs` primitive (§22.9). **Responsive variant:** pills on
  lg/xl; scrollable underline on xs/sm/md (8 tabs don't fit as pills on
  phones).

### 6.3 The eight tabs

| Tab | Content | Source |
|-----|---------|--------|
| **Overview** | Cover, description (TMDB/PS Store), genre, last played, total play time, current cheat profile status, latest save timestamp. | `gamesGet`, `gameActivityGet`, `tmdbGet` |
| **Cheats** | Cheat file management: list of available cheats per trainer; toggle per-cheat; auto-apply profile; conflict detection (§6.3.1). | `cheatsList`, `cheatsDownload` |
| **Saves** | Save slots with version history; backup (per-slot or all); restore; compare; CRC; USB export. | `savesList`, `savesBackup` |
| **Media** | Screenshots + videos (merged from v4's two screens). Kind toggle. Batch export, batch delete, slideshow. | `screenshotsList`, `videosList` |
| **Add-ons** | DLC list (installed + available); install/uninstall; DLC state vs. PSN entitlements. | `dlcList` |
| **Updates** | Available patches; current version; install patch; patch history. | `pkgList`, `bgft` |
| **Storage** | Per-game disk usage breakdown (game data / saves / media / DLC / patches); reclaimable space; integrity check (CRC/Blake3); uninstall-with-cleanup. | `duGet`, `crcCompute` |
| **Play Time** | Total time, sessions timeline, per-day/per-week/per-month aggregates, friends comparison (opt-in). | `gameActivityGet` |

### 6.3.1 Cheat management — safety model

Cheat-enabled launches can crash the game. The safety model:

- **Last known good (LKG).** Every successful launch with cheats stamps the
  applied set as `last_good` (timestamp + hash). The "Launch w/ cheats ▾"
  menu always shows **Last known good** as a separate item that re-applies
  exactly that set.
- **Crash detection.** Telemetry stream reports the running title. If it
  disappears within 60s of a cheat-enabled launch, the Hub flags it as
  "crashed after cheats", does NOT update `last_good`, and shows an inline
  `Callout tone="error"` with three actions: Launch without cheats / Try
  last known good / Keep cheats. (This is an **inline Callout**, not a toast
  — errors are banned from toasts except the §12.3 critical carve-out.)
- **Safe launch.** Always available: applies zero cheats for this launch
  only, without changing the profile.
- **Conflict detection.** Engine rules (in the payload, where the hook
  knowledge is) flag incompatible trainer combinations (e.g. GoldHEN +
  etaHEN simultaneously). Surfaced as a `Callout tone="warn"` in the Cheats
  tab.
- **Pre-launch snapshot.** `param.sfo` and cheat files snapshotted before
  any auto-apply; "Revert to pre-cheats" lives in the Storage tab.

### 6.4 Entry points to the Game Hub

- Click a tile in the Games grid.
- ⌘K → type game name or `CUSA00506` → "Open Game Hub: <name>".
- Recent activity row on Home.
- Continue playing widget on Home.
- Deep-link `ps5upload://games/<title_id>` (mobile).
- Files browser → right-click `.pkg` → "Show in Game Hub" (if installed).

---

## 7. Files Tab

**Route:** `/files`. **Purpose:** a single file browser spanning **PS5 + FTP +
SMB + Local** as **locations**, with **list / grid / tree / disk-usage / search
as view modes**. Replaces the v4 FileSystem, FTP, SMBClient, Search,
DiskUsage, and Volumes screens.

### 7.1 Overall layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Files    [PS5 ▾]  / data / saves ◂ ▸              [⌘K] [⚙]                  │
│ [⬆ Upload] [⬇ Download] [📋 Paste] [⋮]      [⊞ Grid] [☰ List] [Tree] [ DU ]│
├──────────────┬─────────────────────────────────────────────────────────────┤
│ Locations    │                                                             │
│ · PS5 (SSD)  │                                                             │
│ · PS5 (USB)  │                                                             │
│ · FTP        │             (current view: list / grid / tree / DU)         │
│ · SMB        │                                                             │
│ · Local      │                                                             │
│ ─────────    │                                                             │
│ Bookmarks    │                                                             │
│ Recent       │                                                             │
├──────────────┴─────────────────────────────────────────────────────────────┤
│ (selection bar appears when ≥1 row selected: [5 selected] [Copy] [Move]...)│
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Locations sidebar

| Location | Kind | Source |
|----------|------|--------|
| PS5 (SSD/USB) | `ps5` | `GET /api/ps5/volumes` |
| FTP | `ftp` | FTP server (started in Console → Network) |
| SMB | `smb` | `GET /api/smb/list-shares` |
| Local | `local` | Tauri filesystem ( Scoped Storage on Android, §18.4) |

Switching location preserves the path where possible; falls back to volume
root if not.

**Bookmarks** (per-user, persisted): quick-jump entries. Default seed
includes common PS5 paths (`/data/`, `/data/appdata/`, `/system/`, etc.).
**Recent** shows the last 10 visited paths across all locations.

### 7.3 View modes (the four + search)

| View | Use | Notes |
|------|-----|-------|
| **List** (default) | Browsing. | Row height 36px dense / 44px touch. Columns: name, size, mtime, perms, owner. |
| **Grid** | Media-first. | Thumbnails (lazy). Tile 96px / 144px (lg+). |
| **Tree** | Hierarchical. | Lazy expand. |
| **Disk-usage** | Finding space hogs. | Treemap (squarified). Click a tile → drill in. Delete-from-here. |
| **Search** | Find by name/regex. | Cross-location optional. Results unified. |

Switch via `?view=`. Selection state persists across view switches.

### 7.4 Toolbar

- **Path bar** — breadcrumb-style; click any segment to navigate. Supports
  paste-a-path.
- **Always-available actions:** Upload, Download, New folder, Refresh, ⋮ (overflow).
- **Selection-aware actions** (appear when ≥1 row selected): Copy, Cut, Rename,
  Delete, Archive, Checksum, Properties. Switches to a "selection bar" on
  mobile (above the bottom nav).
- **View switcher** — segmented control on the right.

### 7.5 Cross-location operations (clipboard metaphor)

- **Desktop:** drag-and-drop in and out, plus keyboard clipboard
  (Cmd+C/Cmd+X/Cmd+V).
- **Mobile:** clipboard banner appears above the bottom nav when something is
  on the clipboard: `📋 5 items from PS5 SSD · [Paste here] [✕]`. Navigate to
  another location; tap Paste.

The clipboard store is `{ items, sourceLocationId, op: "copy"|"cut" }`.
Paste triggers a `Task` of kind `fs-copy` / `fs-move` (§10).

### 7.6 Batch operations

Multi-select (long-press mobile / shift-click desktop / Cmd+A select-all).
Batch actions:
- **Rename** — opens modal with patterns (`{name}`, `{n}`, `{date}`); preview
  before apply. Triggers `fs-rename` Task.
- **Chmod** — octal or symbolic; preview.
- **Archive** — "Download as ZIP" wired to `startTransferDownloadZip`.
- **Checksum** — CRC32 / Blake3; per-file or folder-level; PS5↔local compare.

### 7.7 Preview / Open-with

Single-click a file → preview pane (right side on desktop, swipe-up sheet on
mobile). Supported formats: images (PNG/JPEG/WebP), JSON, SFO, archive
listing (read-only), hex (binary < 1 MB), text. **Open-with submenu** for
`.pkg` (Install), `.save` (Restore), screenshot (Reveal in Media tab).

### 7.8 Integration points (back to other tabs)

- `.pkg` → chip "Install" (creates `pkg-install` Task)
- `.save` → chip "Restore" (opens Game Hub → Saves)
- screenshot/video → chip "View in Media" (opens Game Hub → Media)
- `.elf` / `.bin` → chip "Send as payload"
- Right-click → "Reveal in Game Hub" if the path corresponds to an installed title

### 7.9 Power-user tools (deep-link to Console → Tools)

The browser does NOT render inline UIs for these — it offers deep-link
affordances that open Console → Tools with arguments pre-filled (per the
orphaned-API single-homing rule, §16.3):

- **UFS fsck** → opens Console → Tools → UFS fsck with volume pre-selected.
- **app.db query** → opens Console → Tools → app.db query with filter pre-filled.
- **Syslog / kernel modules / network interfaces** → rendered as virtual
  read-only filesystem views (special paths like `🐾 /proc/modules`).

### 7.10 Mirror jobs (Pipeline-friendly)

A `mirror` Task kind (added per consistency review R2) does one-way tree
replication: source location → destination location, with size/mtime/CRC
comparison skipping already-mirrored files. Use cases: nightly backup of
saves to SMB; sync homebrew folder between consoles.

### 7.11 Mobile-specific

- Bottom-sheet row actions (long-press a row → sheet of actions).
- Clipboard banner above bottom nav (§7.5).
- Edge-swipe-back is suppressed while clipboard is active (don't lose the
  clipboard on navigation).
- Toolbar collapses: primary actions become icon-only; secondary actions in
  the ⋮ menu.
- Tree/DU views hidden on xs (screen too small); grid/list/search remain.

See File Browser deep-dive §13 for full mobile mockups.

---

## 8. Console Tab

**Route:** `/console`. **Purpose:** system control — everything that isn't a
game, file, or task. 12 sections, left rail / mobile strip. Replaces 11 v4
screens (Hardware, FanCurve, PowerTelemetryPanel, Processes, FTP, nanoDNS,
SpeedTest, FwSpoof, System, Notifications, RemotePlay, Backup, Shell) and
hosts the orphaned-API UIs (UFS fsck, app.db).

### 8.1 The 12 sections

| Section | Content | Replaces |
|---------|---------|----------|
| **Thermal** | Live readings (CPU/GPU/SoC/memory/VRM), fan curve editor, fan profile presets, alert overlays. | Hardware (thermal part), FanCurve |
| **Power** | Battery (DualSense + console), power state, power menu (standby/restart/off), power-on-RTC scheduler. | PowerTelemetryPanel |
| **Processes** | Process list (name, PID, memory, kill button), kernel module viewer. | Processes |
| **Network** | FTP server (start/stop/port/password), nanoDNS, Speed Test, interface list. | FTP, nanoDNS, SpeedTest, Interfaces (orphan) |
| **Firmware** | System summary, firmware version, firmware spoof editor, peripherals, system info. | FwSpoof, System, Peripherals |
| **Notifications** | Inbox (sent + received), send-test, delete, clear. | Notifications |
| **Profile** | Active user, account list, switch user. | Profile |
| **Remote Play** | Connect/launch, settings (resolution/bitrate), session info. | RemotePlay |
| **Backup** | Snapshot create/restore, scope picker, smart suggestions, snapshot history. | Backup |
| **Shell** | Interactive shell (read-line), command palette shortcut, output history, favorites. | Shell |
| **Alerts** | Alert rules editor, active alerts, alert history. | (new — builds on Task System §10.6) |
| **Tools** | UFS fsck modal, app.db SQL query console, time/timezone editor. | (new — closes orphaned-API gaps) |

### 8.2 Thermal Dashboard

Live readings (sparklines + numeric), driven by telemetry stream. **Fan curve
editor:** drag points on a graph (temperature → duty %); presets (Quiet /
Balanced / Performance); "Auto" mode (Sony default). Alert overlays: any
reading in warning/critical band highlights the graph.

### 8.3 Backup & Restore

**Create snapshot** modal: tag (free text), scope (Full / Saves only /
Trophies only / Selected games / **Settings only** — the 5th radio per
consistency review R4), destination path. Smart suggestions banner: "💾 23
games with unbacked-up saves (last backup: never) — [Back up all saves →]".

**Snapshots list:** tag, created, size, [Restore] [Delete]. Restore is
destructive — confirm dialog with tag + scope.

Backup is a Task (`backup-snapshot` / `backup-restore` / `save-backup` /
`save-restore`); retry is per-section.

### 8.4 Alerts

Alert rules: condition (telemetry path + threshold + window), severity (info
/ warn / critical), actions (notify / run task / shell command). Active
alerts surface on all 5 canonical alert surfaces (§12.4). Alert history is
filterable.

### 8.5 Tools (closes orphaned-API gaps)

This is the single home for `ufsFsck` and `appdbQuery` (the consistency
review's C5/R1 resolution). The File Browser deep-links here; it doesn't
render these inline.

- **UFS fsck modal** — three-escalation consent: read-only / fix non-critical
  / fix all (data-loss risk). Volume picker. Gated by "no game running"
  (telemetry stream).
- **app.db SQL console** — read-only by default; Run / Export CSV; Allow-writes
  toggle (with confirm).
- **Time / timezone editor** — set system time, pick timezone.

---

## 9. Tasks Tab

**Route:** `/tasks`. **Purpose:** the unified timeline of every long-running
operation, plus telemetry dashboard, statistics, and automation. Replaces v4
Transfers, History, Activity, AuditLog, Logs.

### 9.1 Views

| View | Route | Content |
|------|-------|---------|
| **Active** | `?view=active` | Running + paused + recently-failed tasks. Live. |
| **History** | `?view=history` | Unified timeline (Transfers + Installs + FS ops + Backups + Activity + AuditLog + Logs). Filterable by kind, date, status, origin. |
| **Telemetry** | `?view=telemetry` | Charts: temperature, fan, transfer rate, disk usage, memory. Threshold overlays. CSV export. |
| **Stats** | `?view=stats` | Aggregate: total uploaded, installs, backups. Per-day/week/month. Per-game breakdown. |
| **Automation** | `?view=automation` | Schedules (cron-like) + pipelines (chained tasks) + automation rules. |

### 9.2 Row anatomy (Active view)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [⏸] [⏵] Upload  /data/big.pkg                    ↑ 14 MB/s   [⋯]         │
│     [████████████░░░░░░░░░] 58% · 12.1 / 20 GB · ETA 8m                  │
│     from PS5 Pro → /data/ · started 14:22 · #01J8X...                    │
└─────────────────────────────────────────────────────────────────────────┘
```
- Pause/Resume toggle (left).
- Kind icon + summary.
- Progress bar + rate + ETA (when running); retry actions (when failed).
- Origin + task ID (click ID → copy; ⌘K `#<id>` jumps here).
- ⋯ menu: cancel, retry, view detail, copy as pipeline, pin to top.

### 9.3 Landing logic

App opens to:
- **Tasks → Active** if any tasks are running or paused.
- **Home → Dashboard** otherwise.

The Changelog opens automatically only on first launch after an upgrade.

---


# Part III — Cross-Cutting Systems

## 10. Unified Task System

The headline gap in v4: three parallel job/status systems with no unified
model. v5 has **one** `Task` envelope. Every long-running operation — uploads,
downloads, filesystem ops, installs, backups, enrichment, library ops,
pipelines — is a `Task`. One lifecycle, one retry policy, one history, one
task ID space.

### 10.1 The `Task` type

```ts
type TaskKind =
  // transfers (engine: jobs map + SSE)
  | "upload-file" | "upload-dir" | "upload-archive"   // .zip/.7z/.rar
  | "download"
  // filesystem ops
  | "fs-delete" | "fs-copy" | "fs-move" | "fs-rename"
  // mirror/sync (File Browser §7.10 — one-way replication tree)
  | "mirror"
  // installs (engine + payload bgft_install_status)
  | "pkg-install" | "pkg-dpi-install"
  // backups (engine: snapshot/restore)
  | "backup-snapshot" | "backup-restore" | "save-backup" | "save-restore"
  // enrichment (lightweight client ops)
  | "tmdb-fetch" | "cheat-download" | "icon-fetch"
  // library ops
  | "library-mount" | "library-register" | "library-unregister" | "library-launch"
  // pipelines (composite — see §10.5)
  | "pipeline";

interface Task {
  // identity
  id: string;                 // ULID — stable across client+engine+history
  kind: TaskKind;
  origin: string;             // "files.upload" | "games.install" | "schedule:nightly-backup" | ...
  createdAt: string;
  // state
  status: TaskStatus;
  progress?: { current: number; total: number; unit: "bytes" | "files" | "items" };
  rate?: { bytesPerSec: number; filesPerSec?: number };
  eta?: number;               // seconds
  // error/retry
  lastError?: { code: string; message: string; recoverable: boolean };
  attempts: number;
  maxAttempts: number;
  // provenance
  consoleId: string;          // which PS5 this runs against
  payload: TaskPayload;       // per-kind specifics
}

type TaskStatus =
  | "queued"        // waiting for a slot
  | "running"       // in progress
  | "paused"        // user-paused (NEW in v5)
  | "awaiting"      // blocked on input (confirm-overwrite, password)
  | "done"
  | "failed"
  | "cancelled";
```

The `paused` lifecycle state is new to v5 — v4 tasks could only run or be
cancelled. Pause is available for kinds that support it (uploads, copies;
NOT for atomic ops like rename-single).

### 10.2 What's recoverable, per kind

The retry matrix that makes "retry doesn't start from scratch" real:

| Kind | Recoverable mid-task? | Resume mechanism |
|------|----------------------|------------------|
| `upload-file` | **Yes** | `txIdHex` + `TX_FLAG_RESUME` — payload's last-acked shard is the resume point. |
| `upload-dir` | **Yes** | Reconcile-mode resume: payload's journal has committed files; only unfinished ones re-send. Idempotent. |
| `upload-archive` (.zip/.7z) | **Partial** | Host-side re-extract; only un-acked shards re-sent. LZMA2 (.7z) can't seek → re-decompress from start, but transfer resumes. |
| `upload-archive` (.rar) | **Partial** | Same as .zip; password re-prompted if `rarPassword` redacted (lost on restart). |
| `download` | **Yes** | `.part` file promotion is server-side; idempotent retry. |
| `fs-delete` | **No** (already freed) | Restart reports "X deleted, Y remaining" — no work redone. |
| `fs-copy` / `fs-move` | **Yes** | Payload `cp_rf` is restartable per-file; reconcile skips done files. |
| `fs-rename` | **Yes** (idempotent) | Atomic per-entry; retry reports "already renamed" for done entries. |
| `mirror` | **Yes** (idempotent) | Tree reconciliation: size/mtime/CRC comparison skips files already mirrored; only deltas transfer. |
| `pkg-install` | **Restart** | Sony install state is opaque; we re-poll `bgft_install_status`. If staged pkg intact, resumes from internal progress; else restart from staged file (no re-upload). |
| `pkg-dpi-install` | **Restart from staged** | DPI is HTTP-source; retry re-downloads from URL unless staged file exists. |
| `backup-snapshot` | **Continue** | Per-section (saves / trophies / settings); partial snapshot taggable as "incomplete". Retry continues from next section. |
| `backup-restore` | **Restart section** | Destructive; retry re-applies the current section from the start (safer than half-applied). |
| `save-backup` | **Per-slot continue** | Each save slot independent; failed slots retry, done slots skip. |
| `cheat-download` / `tmdb-fetch` | **Restart** (idempotent) | Re-download overwrites; no harm. |
| `pipeline` | **Per-step** | Pipeline retries only the failed step; upstream `done` steps never re-run. |

### 10.3 Retry modes

Every failed task offers up to three retry flavors:
1. **Resume** — continue from the last checkpoint (if recoverable).
2. **Restart** — start over from the beginning (always available).
3. **Restart with edits** — re-open the launch modal pre-filled with the task's params, change something, start fresh.

**Auto-retry policy:** default `maxAttempts = 3` (1 initial + 2 retries).
Configurable globally (Settings → Tasks) and per-task (Advanced in the row
menu). Recoverable error classes: connection-class, PS5-side transient
(`direct_writer_io_error` with EAGAIN, OOM-kill), rest-mode/reboot mid-task
(if console returns within 10 min). Non-recoverable: disk-full, permission-
denied, ENOSYS, archive corruption.

### 10.4 Pipelines (task chaining)

A `pipeline` Task is an ordered list of step-tasks with conditional logic:

```ts
type PipelineStep = {
  taskId: string;             // reference to a real Task
  on_success: "continue" | "branch:<stepId>" | "stop";
  on_failure: "retry:<n>" | "stop" | "continue";
};
```

Pipelines are first-class: a "Set up a new PS5" pipeline might be (1) send
payload, (2) wait-for-mgmt-port, (3) start FTP, (4) upload saves, (5) install
5 PKGs in parallel, (6) verify CRCs. Each step's status is visible in the
task row's detail expansion. Pipelines are creatable from a template library
or by chaining existing tasks.

### 10.5 Queue management

Each console has a queue with **per-kind concurrency limits** (defaults:
uploads = 4 parallel; installs = 1; fs ops = 2; backups = 1). User-tunable in
Settings → Tasks. Cross-console queues are independent (no global lock).

Queue actions on a task: priority up/down (move within queue), pin to top,
cancel, pause/resume (releases the slot).

### 10.6 Alert system

Alerts are the user-visible reaction to telemetry thresholds:

- **Rule**: `{ telemetry_path, comparison, threshold, window, severity, actions }`.
  Example: `{ path: "temperature.cpu", comparison: ">", threshold: 85, window: "30s", severity: "critical", actions: ["notify", "throttle-upload"] }`.
- **Severity → surface mapping** (§12.4).
- **Active alerts** drive the bell badge count, the status bar chip, and
  Console banners. Alerts are persistent (survive app restart) until cleared.
- **Alert history** is filterable in Tasks → History.

### 10.7 History consolidation

v4 had 4 separate history surfaces (Activity, AuditLog, Logs, GameActivity).
v5 keeps the **stores** separate (they have different schemas and writers)
but presents them as **one filterable timeline** in Tasks → History:

| Origin store | Mapped to | Filterable as |
|--------------|-----------|---------------|
| `transfers` (jobs) | Tasks | kind in (upload, download) |
| `fs/op-status` | Tasks | kind in (fs-*) |
| `pkg/install` | Tasks | kind in (pkg-*) |
| `Activity` | Tasks | kind = "user-action" |
| `AuditLog` | Tasks | kind = "audit" |
| `Logs` | Tasks (append-only) | kind = "log" |
| `GameActivity` | Game Hub → Play Time | (not in Tasks; lives per-game) |

The unified view is virtual: it queries each store and merges by timestamp.
Each store keeps its own schema.

### 10.8 Automation

Schedules (cron-like) and triggers (on-event) drive task creation:

- **Schedule**: `{ cron, task_template }`. Example: nightly save backup at
  3 AM.
- **Triggers**: on-console-connect, on-firmware-change, on-alert, on-app-
  launch. Each creates a Task from a template.
- **Automation rules**: simple if-then (e.g. "if disk usage > 90%, notify").

**Mobile caveat (Android):** background schedules don't run reliably (Doze
kills the process). v5 documents this as a limitation; a foreground service
is future work (v5.x). Schedules work correctly on desktop.

---

## 11. Telemetry Stream

### 11.1 One stream replaces 6+ polls

v5 replaces v4's per-screen polling with a single SSE stream
`GET /api/telemetry/stream` that pushes JSON events. Screens subscribe to
paths they care about; the store updates reactively.

### 11.2 Canonical paths

| Path | Type | Cadence | Source |
|------|------|---------|--------|
| `connection.state` | enum | on-change | mgmt-port watcher |
| `connection.uptime_s` | int | on-change | derived |
| `temperature.cpu/gpu/soC/memory/vrm` | float (°C) | 1s | payload |
| `fan.duty_pct` | float | 1s | payload |
| `fan.rpm` | int | 1s | payload |
| `power.state` | enum | on-change | payload |
| `power.battery_pct` (DualSense) | int | 5s | payload |
| `storage.internal.free_gb` | float | 10s | payload |
| `storage.external.free_gb` | float | 10s | payload |
| `network.upload_bps` | int | 1s | engine |
| `network.download_bps` | int | 1s | engine |
| `running.title_id` | string | on-change | payload |
| `firmware.version` | string | on-connect | payload |
| `processes.count` | int | 5s | payload |

> **Path canonicalization (consistency review C4):** paths use dotted
> lowercase with units in the final segment. The earlier `storage.free` form
> is deprecated; `storage.internal.free_gb` is canonical.

### 11.3 Consumer pattern

```ts
const temp = useTelemetry(t => t.temperature.cpu);     // reactive hook
```

The hook subscribes on mount, unsubscribes on unmount. The store deduplicates
identical subscriptions and maintains a single SSE connection per console.

### 11.4 Telemetry dashboard (Tasks → Telemetry view)

Charts (sparklines + main graph) for the canonical paths. Threshold overlays
show warning / critical bands. Time-range picker (last 1h / 6h / 24h / 7d).
**CSV export** of the raw samples. Historical data is stored in a ring buffer
on the engine side (default: 24h of 1s samples; user-tunable).

---

## 12. Error, Empty & Toast Policy

### 12.1 Inline errors (default)

Errors render inline via `Callout tone="error"` (§22.24) in the screen where
they occurred. The ErrorBoundary catches render errors and shows an inline
error state with retry.

### 12.2 Empty states

Empty states use the `EmptyState` primitive (§22.29) with `{ title, body?,
action?, hero? }`. `min-height: 55vh` (the v3 docstring value; the 72vh in v4
code is the bug). Default `role="status"` (polite); switch to `role="alert"`
only for error-driven empties.

### 12.3 Toasts

Tones: `info` (4s) / `success` (3s) / `warn` (6s) / `critical` (sticky).
**Toasts are NOT for errors** — except the single carve-out below.

The **`tone="critical"` carve-out** is the *only* error-class tone permitted
in a toast. Used exclusively for Task System §10.6 critical alerts (thermal
trip, power-off imminent) that must surface immediately regardless of current
screen. Maps to the `bad` color token, `role="alert"`, sticky until dismissed
or alert clears. All other errors remain inline.

### 12.4 Alert surfaces — canonical 5

A single alert surfaces on **all that apply** for its severity:

| # | Surface | Where | Persistence | Component |
|---|---------|-------|-------------|-----------|
| 1 | **Inline Callout** in the relevant screen | Console → Thermal (thermal); Tasks row (task); Game Hub (game) | Until dismissed/clears | `Callout tone="error"/"warn"` |
| 2 | **Status bar chip** | Global header | While active; click → #1 | Header chip with `bad`/`warn` dot |
| 3 | **Sticky Console banner** | Top of Console tab | While active | Dismissible per-session |
| 4 | **OS notification** | Desktop notification / Android channel | OS-managed | `Notification` API |
| 5 | **Critical toast** | Top (mobile) / bottom-right (desktop) | Sticky | `useToast({ tone: "critical" })` |

---

## 13. Offline & Recovery

### 13.1 Disconnect detection

Per Task System §10.4, a **disconnect watcher** polls the mgmt port every 2s.
If it fails twice consecutively, the console is marked `disconnected`:
- All running Tasks move to `paused` (not `failed`).
- The status bar shows "Disconnected" with a retry chip.
- Home shows the disconnected hero.
- The Tasks tab shows paused tasks with a "Reconnect to resume" hint.

### 13.2 Rest mode / reboot mid-task

Detected as a brief disconnect (≤ 90s). Tasks that were running are NOT
failed — they auto-resume when the console returns. If the console doesn't
return within 10 minutes, tasks fail with recoverable error class
"console-timeout".

### 13.3 Recovery on app restart

Tasks are persisted in localStorage (client-side task store) and the engine's
`jobs` map (engine side). On app restart:
- The client reconciles its task store with the engine's `jobs` map.
- Tasks the engine still knows about → status updates flow normally.
- Tasks the engine has lost (e.g. engine restarted) → marked `failed` with
  recoverable error "engine-restart"; one-shot auto-retry kicks in for
  recoverable kinds.

---

## 14. Multi-Console Semantics

### 14.1 The roster

The roster is the list of known PS5s (host + alias + last-seen + auth). One
is `active` at a time. Switching the active console is the central navigation
event.

### 14.2 Console switch behavior

| Surface | Behavior on switch |
|---------|-------------------|
| **Route identity** | Preserved. `/games/CUSA00506` stays `/games/CUSA00506`. |
| **Game Hub data** | Refreshed from new console. If `title_id` doesn't exist on new console → inline empty state with "Switch back" button. |
| **Files PS5 location** | Path preserved IF it exists on new console's volume; else fall back to volume root with toast. SMB/Local unaffected. Selection cleared. |
| **Console tab section** | Refreshed. If new console's firmware doesn't support a feature (e.g. FwSpoof), that section shows an empty state. |
| **Tasks** | Tasks for the previous console REMAIN running (they're engine-side, not console-tied). The Tasks tab shows multi-console by default; filter to "this console" if preferred. |
| **Telemetry** | Stream reconnects to the new console. |
| **URL query state** | Preserved (scroll position, filters). |

### 14.3 Adding a console

Roster → Add → enter host + alias + (optional) auth. The new console is probed
(mgmt + transfer + alt-transfer ports); on success it's added and can be
switched to.

---

## 15. Concurrency & Conflict Resolution

### 15.1 Same-file concurrent ops

If two tasks target the same file (e.g. upload to `/data/x.pkg` while a
download of `/data/x.pkg` is running), the engine serializes them via an
inode-level lock. The second task enters `queued` state with reason
"waiting for lock on <path>".

### 15.2 Optimistic UI conflicts

The client uses optimistic updates for fast feedback (e.g. mark a task
"cancelled" immediately). If the engine rejects (e.g. task already
completed), the client reverts and shows an inline callout.

### 15.3 Pipeline concurrency

Pipeline steps are sequential by default. The `parallel:` step prefix runs
multiple steps concurrently with a wait barrier. The pipeline fails if any
required step fails (configurable per-pipeline).

---

## 16. Permissions & Capability Model

### 16.1 Capability gating

Not all features work on all PS5s. The capability model gates UI by firmware
version and payload feature set:

```ts
type Capability =
  | "fan-control"          // FW < 9.00 only (later FW removed the API)
  | "fw-spoof"
  | "remote-play"
  | "backup-snapshot"
  | "ufs-fsck"
  | "appdb-write"
  | "ftp-server"
  | "shell"
  | ...;
```

`useCapabilities()` hook returns the active console's capability set. UI
elements that require a missing capability render as disabled with a tooltip
explaining why.

### 16.2 Destructive-op confirmation

Destructive ops (delete, format, fsck-fix-all, restore) require confirmation.
Confirm uses `ConfirmDialog` (a thin wrapper over Modal with
`role="alertdialog"`). For fsck-fix-all and restore, a type-to-confirm
gesture is required (type the volume name).

### 16.3 Orphaned APIs single-homed (consistency review C5/R1)

| API | Single home | Other docs may deep-link |
|-----|-------------|--------------------------|
| `ufsFsck` | Console → Tools | Files §7.9 (deep-link only) |
| `appdbQuery` | Console → Tools | Files §7.9 (deep-link only) |
| `crcCompute` / `blake3Compute` | Files (toolbar) | Game Hub → Storage (deep-link to Files with path pre-filled) |

---

## 17. Deep-Linking & Navigation

### 17.1 Cross-tab navigation matrix

| From \ To | Home | Games | Files | Console | Tasks |
|-----------|------|-------|-------|---------|-------|
| Home | — | Recent → game; Continue → game | Quick action → Upload (Files opens w/ picker) | Quick action → Console | Recent failed → Retry (Tasks → that task) |
| Games (grid) | — | — | ⋯ → Reveal in Files | — | — |
| Game Hub | ← Back | (internal) | Storage → Reveal in Files | Add-ons → entitlements lookup | Updates → install creates task → Show in Tasks |
| Files | — | `.pkg` → Install (creates task) → jump to Tasks | (internal) | `🐾 /proc/modules` deep-link | Upload → creates task → visible in Tasks |
| Console | — | — | FTP → "Browse files" → Files (FTP location) | (internal) | Backup → creates task → Show in Tasks |
| Tasks | — | Install task → Show in Games | Upload task → Show in Files | Backup task → Show in Console → Backup | (internal) |

### 17.2 Deep-link preservation on console switch

See §14.2 — URL identity is preserved across switches.

### 17.3 Modal-via-URL

When a modal is the primary reason for the visit (e.g. Send-payload from
Home), it's URL-encoded: `/?modal=send-payload`. Browser back closes the
modal.

### 17.4 File-selection deep-links

Files URL: `?select=id1,id2`. Used by Game Hub → Storage → "Show these files"
chips. The browser opens with those rows selected and the selection bar
visible.

### 17.5 Command Palette (⌘K / Ctrl+K)

Unified ⌘K spec covering navigate / act / run-shell / jump-to-task:

- **Navigate** — type a tab name, game name, or route → jump.
- **Act** — "Start FTP server", "Backup all saves", "Kill process: SceShellUI".
- **Run shell** — type a shell command → Enter executes on PS5.
- **Jump to task** — `#<task-id>` (or "task <id>") → Tasks tab with row
  scrolled into view and briefly highlighted.

Component: `Spotlight`-pattern combobox (§22.21) with full WAI-ARIA. Mobile:
tap ⌘K icon → full-screen Spotlight; long-press → peek Sheet (top 5 actions).

---


# Part IV — Platform Layer

## 18. Mobile / Android

Mobile is a first-class target, not a desktop shrink. The 20 mobile gaps
(M1-M20) catalogued in `v5-mobile-design.md` are all resolved in this
section.

### 18.1 Platform detection

`lib/platform.ts` exports:
- `isAndroid()`, `isIOS()`, `isMobile()` — boolean platform checks (existing).
- `formFactor(): "phone" | "tablet" | "desktop"` — new.
- `inputMode(): "touch" | "mouse" | "hybrid"` — new.
- `responsiveTier(): "xs" | "sm" | "md" | "lg" | "xl"` — new.

`useResponsiveTier()` hook drives conditional rendering based on the current
tier. Never use `isMobile()` alone — it's too coarse (a tablet is "mobile"
but has more screen).

### 18.2 Bottom nav + top bar

See §3.6 for layout. **Bottom nav:** 56px + safe-area, 5 items, icon + label
(labels hidden on xs). Hardware back button wired through explicit
`backStack` (§18.6).

**Top bar:** 44px + safe-area. Console selector center; ⌘K and ⚙ right. Status
bar values collapse to a single temperature chip (`🔥 78°`).

### 18.3 Hardware back button (Android)

An explicit `backStack` with typed entries:
```ts
type BackEntry =
  | { kind: "close-modal"; modalId: string }
  | { kind: "navigate"; to: string }
  | { kind: "fs-up" }                          // Files: go up one directory
  | { kind: "hub-tab-back" }                   // Game Hub: back to Overview
  | { kind: "clear-clipboard" }                // Files: clear clipboard
  | { kind: "exit" };                          // last entry — exit app
```

On Android hardware back (or edge-swipe-back), the top entry is popped and
its action executed. This fixes the v4 "default Webview" behavior that
exited the app at the wrong moment.

### 18.4 Scoped Storage (Android)

First-run wizard step: explain + grant. `lib/pickPath.ts` branches on
`isAndroid()` to use the Storage Access Framework picker. Persistent
permissions are stored so subsequent launches don't re-prompt.

### 18.5 Keep-awake policy

Keep-awake (via Wake Lock API) is enabled during active tasks and disabled
otherwise. Battery-aware:
- Battery > 30% and a task is running → keep awake.
- Battery 15-30% → keep awake but warn.
- Battery < 15% → do NOT keep awake; task continues with screen off (Android
  may still kill it under Doze — see §18.8).
- Plugged in → always keep awake.

### 18.6 Touch targets & gesture library

**Touch targets:** 44×44 minimum everywhere via component primitives. AA
floor 24×24 for dense data-grid cells only.

**Gesture library:**
| Gesture | Action | Where |
|---------|--------|-------|
| Tap | Activate | everywhere |
| Long-press | Context menu / multi-select | list rows, game tiles |
| Swipe-right | Back (suppress if clipboard active) | everywhere |
| Pull-down | Refresh | scrollable lists |
| Pinch | Zoom | images, disk-usage treemap |
| Two-finger swipe-down | Dismiss modal | modals |
| Three-finger tap | Toggle ⌘K (a11y) | everywhere |

### 18.7 Haptic vocabulary (4 events)

| Event | Vibration pattern | When |
|-------|-------------------|------|
| `tap` | 10 ms light | Tab change, button tap |
| `selection` | 8 ms light | Toggle/Checkbox/Radio/SegmentedControl change |
| `confirm` | 20 ms medium | Destructive confirm, task start |
| `danger` | [20, 50, 40] ms heavy | Critical alert, power off confirm |

Uses `navigator.vibrate` (Android WebView). Silenced by a global Setting →
Accessibility → "Haptic feedback".

### 18.8 Tauri Mobile limitations (documented)

- **No background schedules/uploads on Android** — Doze kills the process. A
  foreground service is future work (v5.x). Schedules work on desktop.
- **No persistent notification channel until v5.x** — interactive
  notifications are stubbed.
- **WebGL/WebGPU availability varies** — some renders may fall back.

These are documented in the app (Settings → About → Limitations) so users
aren't surprised.

### 18.9 Intents, sharing & deep-links

- **Share-to-app intent filter** for `.pkg`, `.elf`, `.bin`, `.lua`, `.jar`.
  Sharing a file to ps5upload opens the relevant flow (PKG → install modal;
  ELF/BIN → send-payload modal; LUA → shell editor).
- **Deep-link scheme** `ps5upload://` — routes: `ps5upload://games/<title_id>`,
  `ps5upload://files?path=...`, `ps5upload://tasks/<id>`.

### 18.10 Install / update / first-launch

APK install with first-launch wizard (§5.5 + Scoped Storage step). Updates
are manual via APK re-install (no Play Store). The app checks a self-hosted
update endpoint on launch.

### 18.11 Performance & memory

- **Memory budget:** target < 150 MB resident on Android. Virtualize long
  lists (`react-window`). Lazy-load tab content. Lazy-load images.
- **Bundle:** initial bundle < 300 KB gzipped; Drawer / modals / ⌘K split
  out.
- **Backgrounding** triggers a state-flush to localStorage + engine.

### 18.12 Tablet / large-screen mobile

On md tier (768-1023px), the layout gains a second column where applicable
(Game Hub side panel, Files preview pane). On lg tablets, the layout becomes
desktop-style (left rail) — same as desktop.

---

## 19. Desktop Specifics

### 19.1 Window chrome

Custom title bar on macOS / Windows with the standard traffic-light / window-
controls. Console selector lives in the title bar center.

### 19.2 Keyboard navigation

Full keyboard nav (see §20). Global shortcuts: Alt+1..5 (tabs), Alt+D
(Drawer), Cmd+K (palette), Cmd+, (Settings), Cmd+Q (quit). Per-component
contracts in §22.

### 19.3 Drag-and-drop

Drag-and-drop into and out of the Files browser. Drag a file from macOS
Finder into Files → upload Task. Drag a row from Files to a folder → move
Task.

### 19.4 Native notifications

Uses the desktop OS notification system. Critical alerts bypass DND.

---


# Part V — Design System

## 20. Accessibility Conformance (WCAG 2.2 AA)

### 20.1 Conformance target

**WCAG 2.2 Level AA** is the conformance target. AAA is strived for where
feasible (touch targets 44×44 are AAA 2.5.5; we adopt them as project
default).

### 20.2 Current-state audit (v4.3.2) — headline gaps

- `Button` default size is `sm` (36px) — fails touch target.
- 100+ raw `<input>`, 30+ raw `<select>`, 40+ raw checkbox, 50+ inline badge
  spans across 41 screens — none use shared primitives with consistent ARIA.
- ErrorBoundary references nonexistent CSS tokens (`--color-bg`,
  `--color-surface-hover`).
- CommandPalette missing combobox ARIA. OverflowMenu missing arrow-key nav.
- No app-level Toaster. No screen reader testing performed.
- `--color-muted` luminance ~0.66 — fails 4.5:1 for body text.

### 20.3 Token fixes (consistency review R32)

The full ErrorBoundary broken-token list (canonical):
- `--color-bg` (nonexistent) → `--color-surface`
- `--color-surface-hover` (nonexistent) → `--color-surface-3`
- `text-white` → `--color-accent-contrast`

Plus: `--color-muted` luminance bumped from 0.66 → 0.70. Semantic text
colors (`--color-text`, `--color-text-muted`, etc.) bumped to clear 4.5:1.

### 20.4 Keyboard navigation

#### 20.4.1 Global shortcuts (v5 canonical)

| Shortcut | Action |
|----------|--------|
| `Alt+1`..`Alt+5` | Switch tab |
| `Alt+D` | Open Drawer |
| `Cmd/Ctrl+K` | Open Command Palette (combobox pattern, §22.21) |
| `Cmd/Ctrl+,` | Open Settings |
| `Cmd/Ctrl+/` | Show keyboard shortcut help |
| `Esc` | Close topmost overlay (modal/menu/palette) |
| `?` | Show contextual help |

#### 20.4.2 Per-component keyboard contracts

Every primitive in §22 lists its keyboard contract. Headline: Tabs uses the
WAI-ARIA arrow-key pattern (not tab-into-tab); Menu uses arrow keys + Home/End
+ type-ahead; Combobox (CommandPalette) uses arrow + Enter + Esc; Grid
(Table) uses arrow-key cell navigation.

#### 20.4.3 Skip navigation

A `SkipNav` link (first focusable element) jumps focus to the main content
region. Visible only on focus.

#### 20.4.4 Focus ring

Global `:focus-visible` style: 2px solid `--color-accent`, 2px offset, rounded.
No `outline: none` anywhere; never remove focus indication.

### 20.5 Focus management

- Route changes → focus jumps to the new page's `<h1>` (or main region).
- Modal open → focus the first interactive element (or the title); trap focus
  inside; Esc closes; restore focus to the trigger on close.
- List virtualization → preserve focus on the logical row, not the DOM node.
- Drawer open → focus first item; close on Esc or outside-click.

### 20.6 Screen reader support

- Use semantic HTML first (`<nav>`, `<main>`, `<button>`, `<dialog>`).
- Add `aria-label` when the visible text isn't sufficient (icon-only buttons).
- `LiveRegion` for dynamic updates (task progress, alerts).
- `.sr-only` utility class for visually-hidden text.
- Testing: NVDA + Firefox, VoiceOver + Safari, Android TalkBack.

### 20.7 Color & contrast

4.5:1 minimum for body text; 3:1 for large text and UI component graphics.
Semantic text colors all pass. Color is never the only signal — pair with
icon, text, or shape.

### 20.8 Motion sensitivity

Three motion modes (Setting → Accessibility → Motion):
- **Full** — all animations.
- **Reduced** — shorten durations, disable parallax.
- **None** — disable all non-essential animation.
- Default: **Auto** (follows OS `prefers-reduced-motion`).

### 20.9 Cognitive & reading accessibility

- Dyslexia-friendly font option (TBD — probably Atkinson Hyperlegible or
  OpenDyslexic).
- Text size: 80%-150% range slider (existing `uiScale`).
- Reading order follows DOM order; no CSS reorder surprises.
- Link purpose clear from link text alone (no "click here").

### 20.10 Touch accessibility

44×44 minimum everywhere via primitives (§22). Spacing between adjacent
targets ≥ 8px to prevent mis-taps.

### 20.11 A11y testing strategy

- **Automated:** axe-core in unit tests; Lighthouse CI on each PR.
- **Manual:** keyboard-only walkthrough every release; screen reader spot-
  checks on new screens.
- **Checklist:** every PR that touches UI fills out a short a11y checklist.

---

## 21. Visual Design Language

### 21.1 Token system (4 layers)

1. **Primitive tokens** — raw values. `--color-blue-500: #3b82f6;`.
2. **Semantic tokens** — role-bound. `--color-accent: var(--color-blue-500);`.
3. **Component tokens** — component-bound. `--button-bg: var(--color-accent);`.
4. **Utility tokens** — spacing, radius, shadow. `--space-2: 0.5rem;`.

Components reference only layers 2-3. Layers 1 and 2 are themed.

### 21.2 Typography scale

| Token | Size | Line | Use |
|-------|------|------|-----|
| `--text-xs` | 12px | 16px | badges, captions |
| `--text-sm` | 14px | 20px | secondary text |
| `--text-base` | 16px | 24px | body |
| `--text-lg` | 18px | 28px | lead |
| `--text-xl` | 20px | 28px | h4 |
| `--text-2xl` | 24px | 32px | h3 |
| `--text-3xl` | 30px | 36px | h2 |
| `--text-4xl` | 36px | 40px | h1 |

Font: **Inter** (UI) + **JetBrains Mono** (code/monospace). Both variable
fonts.

### 21.3 Color system (4 themes)

| Theme | Use |
|-------|-----|
| **dark** | Default. Dark surfaces, light text. |
| **light** | Daytime / bright rooms. |
| **oled** | True black (`#000`) for OLED battery saving. |
| **rose** | Accent variation (rose-pink instead of blue). |

Theme cycle: dark → light → oled → rose. Persisted per device via
`state/theme.ts`.

### 21.4 Elevation & z-index

| Token | Shadow | Use |
|-------|--------|-----|
| `--elev-1` | subtle 1px | cards, sticky rows |
| `--elev-2` | soft drop | hover, dropdowns |
| `--elev-3` | medium drop | popovers, menus |
| `--elev-4` | strong drop | modals, sheets |
| `--elev-5` | maximum | toasts over modals |

z-index ramp: `--z-base: 0`, `--z-sticky: 100`, `--z-drawer: 800`,
`--z-modal: 900`, `--z-sheet: 950`, `--z-toast: 1000`.

### 21.5 Motion language

- ** durations:** fast 150ms, base 200ms, slow 300ms.
- **easings:** `--ease-out` (default for entrances), `--ease-in-out`
  (transitions), `--ease-spring` (playful / confirmations).
- Respect `prefers-reduced-motion` / Motion setting (§20.8).

### 21.6 Iconography

**Lucide** icon library (tree-shakeable). Standard sizes: 16 (inline), 20
(button), 24 (nav/hero). Stroke width 2px default. Icon-only buttons MUST
have an `aria-label`.

### 21.7 Density modes

| Mode | Default for | Row height | Card padding |
|------|-------------|-----------|--------------|
| **Comfortable** | Touch | 44px+ | `p-4` |
| **Compact** | Mouse | 36px | `p-3` |
| **Spacious** | (opt-in) | 56px+ | `p-6` |

Auto: Comfortable on touch / Compact on mouse. User-overridable.

### 21.8 Glassmorphism

Used for: header (always), modal scrims (subtle), Drawer (when overlapping
content). `backdrop-filter: blur(18px)` + semi-transparent surface token.
Falls back to solid surface token when `backdrop-filter` unsupported.

---

## 22. Component Primitive Library

**28 primitives** specified below. Each has a full WAI-ARIA contract and
keyboard behavior. **Default size for all interactive primitives is `md`
(44px).**

The 21 NEW primitives and 7 evolved primitives are migrated in 7 phases
(§24). After migration: **zero raw `<input>` / `<select>` / `<textarea>` in
screens.**

### 22.1 `Button` (evolve)

```tsx
interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";        // sm=36px, md=44px (DEFAULT), lg=52px
  loading?: boolean;                 // shows Spinner, disables
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  // ...standard button props
}
```
- Default size changed from `sm` to `md` (closes the headline touch-target gap).
- Adds `lg` size for primary CTAs in empty states and modals.

### 22.2 `IconButton` (NEW)

```tsx
interface IconButtonProps {
  icon: LucideIcon;
  "aria-label": string;              // REQUIRED
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";                // always square — sm=36, md=44
  disabled?: boolean;
  disabledReason?: string;           // → tooltip
}
```

### 22.3 `Input` (NEW)

```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: LucideIcon;
}
```
- Replaces all raw `<input>`. Field error displays below with `role="alert"`.

### 22.4 `Select` (NEW)

Native-styled with WAI-ARIA Listbox pattern on dropdown. `label` / `hint` /
`error` like `Input`.

### 22.5 `Textarea` (NEW)

Like `Input` but multiline. Auto-grow option.

### 22.6 `Checkbox` (NEW)

```tsx
interface CheckboxProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
}
```
- 20px visual box (mouse), 24px visual + 44px hit area (touch).

### 22.7 `Toggle` (Switch) (NEW)

52×28px track + thumb; 44px hit area. Haptic `selection` event on change.

### 22.8 `RadioGroup` (NEW)

Full WAI-ARIA Radiogroup pattern (arrow keys, `aria-checked`).

### 22.9 `Tabs` (generalize from TabbedShell)

```tsx
interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: React.ReactNode; content: React.ReactNode }[];
  variant?: "underline" | "pills" | "segmented";
  size?: "sm" | "md";
  ariaLabel?: string;
}
```
- Three visual variants: underline (TabbedShell style), pills (Game Hub on
  lg/xl), segmented (File Browser view modes).
- **Responsive variant note:** Game Hub uses pills on lg/xl and scrollable
  underline on xs/sm/md (8 tabs don't fit as pills on phones).
- Full WAI-ARIA Tabs pattern.
- `TabbedShell` becomes a thin wrapper syncing `value` with
  `useSearchParams`.

### 22.10 `Badge` (NEW)

```tsx
interface BadgeProps {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad" | "ps4" | "ps5";
  variant?: "solid" | "subtle" | "outline";
}
```

### 22.11 `Card` (evolve)

Existing. Standardize padding, header/footer slots.

### 22.12 `Tooltip` (NEW)

Hover/focus after 500ms delay. `role="tooltip"`. Dismissed on Esc / blur /
scroll.

### 22.13 `Table` / `DataGrid` (NEW)

Virtualized (via `react-window`). WAI-ARIA Grid pattern: arrow-key cell
navigation, sortable headers, selectable rows. Sticky header.

### 22.14 `Drawer` (NEW, extract from AppShell)

Left-side (desktop) / bottom-sheet (mobile). Focus trap, Esc to close.

### 22.15 `Sheet` (NEW — bottom sheet)

Mobile-first. Peek (40% height) / half / full. Drag-handle to dismiss.
Backdrop dim.

### 22.16 `ContextMenu` (NEW)

Right-click (desktop) / long-press (mobile). WAI-ARIA Menu pattern.

### 22.17 `Toaster` / `useToast` (NEW)

```tsx
interface ToastOptions {
  message: string;
  tone?: "info" | "success" | "warn" | "critical";
  duration?: number;                  // info 4s, success 3s, warn 6s, critical sticky
  action?: { label: string; onClick: () => void };
}
```
- One `<Toaster />` at app root.
- `role="status"` (polite) for info/success; `role="alert"` for warn/critical.
- **`tone="critical"` carve-out:** the *only* error-class tone permitted in a
  toast. Sole use: Task System §10.6 critical alerts. Sticky. All other
  errors are inline Callouts.

### 22.18 `Spinner` (NEW, formalize)

```tsx
function Spinner({ size = 16, className }: { size?: number; className?: string });
```
- Decorative (`aria-hidden`); surrounding `aria-busy="true"` conveys loading.

### 22.19 `SkipNav` (NEW)

First focusable element. Hidden until focused. Jumps to `#main-content`.

### 22.20 `LiveRegion` (NEW)

```tsx
<LiveRegion politeness="polite | assertive">{message}</LiveRegion>
```
- For dynamic announcements (task progress, alerts).

### 22.21 `Spotlight` (NEW — Games tab hero)

```tsx
interface SpotlightAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}
interface SpotlightProps {
  game: { title: string; iconUrl?: string };
  actions: SpotlightAction[];
  onClose: () => void;
}
```
- Full-screen on mobile, large panel on desktop. Blurred backdrop from
  `game.iconUrl`.
- **Mobile trigger model:** tap a game tile → full-screen Spotlight;
  long-press → peek Sheet (top 2-3 actions), tap "More" → full Spotlight.

### 22.22 `SegmentedControl` (NEW)

For small mutually-exclusive choice sets (File Browser view modes, Charts
range picker).

### 22.23 `Breadcrumb` (NEW)

For Files path bar.

### 22.24 `Callout` (consolidate ErrorCard / SuccessCard / WarningCard)

```tsx
interface CalloutProps {
  tone: "info" | "good" | "warn" | "error";
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: Array<{ label: string; onClick: () => void }>;
  icon?: LucideIcon;
  onDismiss?: () => void;
}
```
- Replaces ErrorCard and the v4 success/warning cards. Used for inline errors
  (default), empty-state error contexts, Game Hub crash-recovery.

### 22.25 `ProgressBar` (evolve)

Existing. Adds indeterminate variant.

### 22.26 `Modal` (evolve)

```tsx
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";   // NEW: full
  variant?: "center" | "sheet";                 // NEW: sheet (mobile)
  closeOnScrim?: boolean;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
}
```
- `variant="sheet"` = bottom-sheet on mobile, centered on desktop.
- `size="full"` for fullscreen modals (Command Palette mobile, image viewer).
- **`ConfirmDialog` is NOT a separate primitive** — it remains a thin wrapper
  over Modal (`role="alertdialog"`) exposing `useConfirm` / `useAlert` /
  `usePrompt` hooks. Only v5 change: the prompt-input `.input` class is
  replaced by the new `Input` primitive.

### 22.27 `Menu` (evolve OverflowMenu → add arrow-key nav)

Adds WAI-ARIA Menu arrow-key navigation, type-ahead, Home/End. Existing
OverflowMenu becomes a wrapper that triggers a Menu.

### 22.28 `.sr-only` utility class (NEW)

The standard visually-hidden pattern. Used by LiveRegion, SkipNav.

### 22.29 `EmptyState` (evolve)

```tsx
interface EmptyStateProps {
  title: string;
  body?: React.ReactNode;
  action?: { label: string; onClick: () => void; primary?: boolean };
  hero?: React.ReactNode;
  role?: "status" | "alert";          // default "status"
}
```
- `min-height: 55vh` (canonical — fixes the 72vh bug in v4).
- `title` is `<h2>` (or `<h3>` when nested in a panel).
- Single action only; multi-action empty states use a `Menu`.

---

## 23. Accessibility Settings Panel

Settings → Accessibility (Drawer → Settings → Accessibility panel):

| Setting | Control | Default | Effect |
|---------|---------|---------|--------|
| **Motion** | SegmentedControl: Full / Reduced / None | Auto (follows OS) | §20.8 |
| **High contrast** | Toggle | Off (auto-on if OS `prefers-contrast: more`) | Stronger semantic token contrast |
| **Color blind palette** | Select: Default / Deuteranopia / Protanopia / Tritanopia | Default | Color palette adjustment |
| **Dyslexia-friendly font** | Toggle | Off | Swap to dyslexia-friendly font |
| **Text size** | Range slider (80%-150%) | 100% | §20.9 |
| **Density** | SegmentedControl: Comfortable / Compact / Spacious | Auto (touch=Comfortable, mouse=Compact) | §21.7 |
| **Haptic feedback** | Toggle | On (mobile only) | §18.7 |
| **Screen reader hints** | Toggle | Off | Adds verbose `aria-label`s |

All accessibility settings persist via `userConfig.ts` (localStorage + Tauri
store) and apply before React mounts (same pattern as theme + uiScale) to
avoid a flash of the wrong mode.

---


# Part VI — Delivery

## 24. Migration Path

### 24.1 Strategy

v5 is a substantial rewrite but **not a from-scratch rebuild**. Existing
engine code (axum routes, payload C, proto frame types) is reused as-is. The
client is restructured: AppShell + Router is replaced, 41 screens are
consolidated into 5 tab areas + Drawer surfaces, and shared primitives
replace raw HTML elements.

The migration is sequenced to de-risk: **primitives first** (so all screen
work consumes them), then **tab builds in parallel**, then **mobile polish**.

### 24.2 Settings sub-panels (migrated first as dogfood)

The Settings drawer is migrated first because:
- It's small (~5 screens collapsed into 1 modal with panels).
- It exercises every primitive (Inputs, Toggles, Selects, Checkboxes,
  Buttons, RadioGroups).
- A11y dogfooding: if Settings isn't a11y-clean, nothing will be.

Settings panels: **General** (theme, language, paths, default behaviors) ·
**Accessibility** (§23) · **Tasks** (concurrency limits, retry defaults) ·
**Advanced** (experimental flags, developer options) · **About** (version,
licenses, limitations).

### 24.3 The 7 primitive-migration phases (~19 days)

| Phase | Effort | Scope |
|-------|--------|-------|
| 1. Tokens + utilities | 2 days | CSS + token fixes (§20.3), `.sr-only`, data attributes |
| 2. Atoms | 4 days | 8 form primitives (Button, IconButton, Input, Select, Textarea, Checkbox, Toggle, RadioGroup) |
| 3. Molecules | 3 days | 8 display/feedback primitives (Badge, Card, Tooltip, Callout, ProgressBar, Spinner, EmptyState, SegmentedControl) |
| 4. Organisms | 4 days | 7 overlay/navigation primitives (Modal, Drawer, Sheet, ContextMenu, Toaster, SkipNav, LiveRegion) |
| 5. Domain | 3 days | Table/DataGrid, Spotlight, Tabs, Menu, Breadcrumb |
| 6. Fixes | 1 day | ErrorBoundary tokens, GameIcon `alt`, all raw `<input>` etc. removed |
| 7. Settings migration | 2 days | Settings as dogfood + a11y Settings panel |
| **Total** | **~19 days (4 weeks)** | |

Phase 7 (remaining screen migrations) continues in parallel with the tab
builds (Phase 5.1) — each rewritten screen uses primitives by default; each
non-rewritten screen is migrated opportunistically.

### 24.4 Screen consolidation map

| v4 screen(s) | v5 home | Notes |
|--------------|---------|-------|
| Dashboard | Home tab | Widgets; 0 polls. |
| Connection | Home → Connection card | |
| Payloads | Home → Send-payload modal | Modal-via-URL. |
| Library + InstalledApps | Games tab | Merged — origin filter. |
| Cheats + Saves (per-game) | Game Hub → Cheats, Saves tabs | |
| Screenshots + Videos | Game Hub → Media tab | Merged — kind toggle. |
| GameActivity | Game Hub → Play Time tab | |
| SDKChanger | Game Hub → (advanced menu) | |
| FileSystem + FTP + SMBClient | Files tab | Unified browser, locations. |
| Search | Files → Search view | Mode within browser. |
| DiskUsage | Files → Disk-Usage view | Mode within browser. |
| Volumes | Files → Volumes view | Mode within browser. |
| Hardware + FanCurve | Console → Thermal | |
| PowerTelemetryPanel | Console → Power | |
| Processes | Console → Processes | + kernel module viewer. |
| FTP + nanoDNS + SpeedTest | Console → Network | |
| FwSpoof + System + Peripherals | Console → Firmware | |
| Notifications | Console → Notifications | |
| Profile | Console → Profile | |
| RemotePlay | Console → Remote Play | |
| Backup | Console → Backup | + smart suggestions. |
| Shell | Console → Shell | |
| (new) | Console → Alerts | Alert rules + history. |
| (new) | Console → Tools | UFS fsck + app.db query + time. |
| Transfers | Tasks → Active | Unified. |
| Activity + AuditLog + Logs | Tasks → History | Unified timeline. |

**Net:** 41 v4 screens → 5 tab areas + Drawer surfaces. ~10,015 LOC of v4
screens consolidated into Home + Console alone.

---

## 25. Implementation Phases

The canonical phased plan. All sub-docs cross-reference this section. Phase
IDs use suffix letters to avoid collision: `a`-`f` = Game Hub, `g`-`k` =
Home/Console, `l` = Files, `m` = Tasks, `-mo` = mobile, `a`-`f` (5.2) =
cross-tab integration.

### Phase 5.0 — Foundation (~3 weeks)

1. **CSS token fixes** (§20.3) — `--color-bg` etc., `--color-muted` bump.
2. **`platform.ts` extensions** — `formFactor()`, `inputMode()`,
   `responsiveTier()`, `useResponsiveTier()`.
3. **`lib/haptics.ts`** — 4-event vocabulary (§18.7).
4. **`useBackStackStore`** — typed back-button stack (§18.3).
5. **Safe-area backfill** — all remaining locations.
6. **Overscroll-behavior + PullToRefresh** — everywhere applicable.
7. **Primitive build phases 1-7** (§24.3, ~19 days).
8. **Settings migration** (dogfood).

### Phase 5.1 — Tab builds (parallel, ~5 weeks)

Each tab builds independently; integration happens in 5.2.

**Game Hub (5.1-a..f, ~3 weeks):**
- a. Game Hub shell (8 tabs, header, launch split button).
- b. Overview + Games grid aggregator (merges Library + InstalledApps).
- c. Cheats tab (with LKG safety model, §6.3.1).
- d. Saves tab.
- e. Media tab (merges Screenshots + Videos).
- f. Add-ons + Updates + Storage + Play Time tabs.

**Home/Console (5.1-g..k, ~5.5 weeks):**
- g. Console shell (12 sections) + Thermal Dashboard.
- h. Console: Power, Processes, Network.
- i. Console: Profile, Remote Play, Shell, Backup.
- j. Console: Notifications, Alerts, Tools.
- k. Home tab (widgets, Connection card, Send-payload modal, Payload
  Manager modal).

**Files (5.1-l.1..l.6, ~7.5 weeks):**
- l.1. Browser shell + locations + sidebar.
- l.2. View modes (list/grid/tree) + search.
- l.3. Preview + bookmarks.
- l.4. Batch ops (rename/chmod) + archive-out + checksum.
- l.5. Cross-location + mobile clipboard.
- l.6. Integration points + tools deep-links.

**Tasks (5.1-m, ~3 weeks):**
- m. Tasks tab (Active/History views) + telemetry stream + statistics.

**Mobile (5.1-mo / 5.1-mo2, parallel, ~4 weeks):**
- mo. Per-tab mobile patterns: bottom nav, top bar, drawer sheet, modal-as-
  bottom-sheet, hardware back-button wiring.
- mo2. Files mobile clipboard + selection.

### Phase 5.2 — Cross-tab integration (~3 weeks)

- a. **Alert integration** — Console banner, status bar chip, OS notification,
  critical toast, alert rules editor, alert history.
- b. **Telemetry stream rollout** — disconnect/recovery (§13), alert
  thresholds.
- c. **History consolidation** — unified timeline view.
- d. **Automation** — schedules, triggers, rules.
- e. **Mirror jobs** — `mirror` Task kind + Files modal.
- **5.2-mo (mobile, ~2 weeks parallel):** Scoped Storage first-run wizard;
  share-to-app intent filter + routing; deep-link registration; OS
  notification channels (§18.8); interactive notification actions; keep-awake
  auto-disable policy (§18.5); battery optimization prompt.

### Phase 5.3 — Polish (~1 week)

- Performance tuning (memory budgets, virtualization, code-split verification).
- A11y audit pass (axe-core, keyboard walkthrough, screen reader spot-checks).
- Documentation (in-app Help, FAQ update).
- Release prep (CHANGELOG, release notes).
- **5.3-mo (mobile, ~1 week):** Haptic vocabulary rollout everywhere;
  pull-to-refresh on Library/Tasks/Notifications; splash screen; tablet
  2-col layouts; performance tuning.

**Total: ~12-14 weeks** with parallelization. Sequential critical path:
5.0 → 5.1-m (Tasks) → 5.2-a (Alerts) → 5.3.

---

## 26. Gap-to-Section Indices

### 26.1 Feature-completeness audit (~50 gaps, by category)

| Category | Gap examples | Resolved in |
|----------|--------------|-------------|
| **Game Hub** | 1. No uninstall-with-cleanup; 2. No DLC management; 3. No CRC verify; 4. No update detection; 5. No safe-launch; 6. No cheat conflict detection; 7. No cheat conflict surfacing; 8. No game lifecycle (install/launch/uninstall in one place); 9. No save version history; 10. No save compare; 11. No multi-select on grid; 12. No favorites/collections. | §6 (Game Hub). |
| **Files** | 1. No mobile cross-location ops; 2. No preview; 3. No bookmarks; 4. No batch rename; 5. No mirror; 6. No archive-out; 7. No checksum (toolbar-level); 8. No delete-from-disk-usage. | §7 (Files). |
| **Tasks** | 1. No retry/re-run; 2. No task chaining; 3. No queue management; 4. No unified history; 5. No alert system; 6. No statistics. | §10 (Tasks). |
| **Home** | 1. Dashboard read-only; 2. Connection standalone screen; 3. No quick-launch; 4. No smart suggestions; 5. No activity jump-links; 6. Payloads buried. | §5 (Home). |
| **Console** | 1. No syslog UI; 2. No module viewer; 3. No network interface list; 4. No app.db query; 5. No UFS fsck; 6. No time/timezone; 7. No fan curve presets; 8-12. (various). | §8 (Console). |
| **Cross-cutting** | Telemetry, offline, multi-console, etc. | Parts III + IV. |

### 26.2 Mobile gaps (M1-M20, all resolved)

| # | Gap | Resolved in |
|---|-----|-------------|
| M1 | Bottom nav items too small | §3.6 (56px nav, 44px items). |
| M2 | Hardware back button wrong behavior | §18.3 (`backStack`). |
| M3 | No Scoped Storage wizard | §18.4. |
| M4 | No keep-awake policy | §18.5. |
| M5 | No haptic feedback | §18.7. |
| M6 | Modals unusable on phone | §22.26 (`variant="sheet"`). |
| M7 | Drawer hard to reach | §3.4 (bottom-sheet on mobile). |
| M8 | No share-to-app | §18.9. |
| M9 | Tablet layout is phone-stretched | §18.12. |
| M10 | No haptic vocabulary | §18.7. |
| M11-20 | (see `v5-mobile-design.md` §0) | §18. |

### 26.3 Consistency-review findings (33, all applied)

See `docs/v5-consistency-review.md` for the full register. Headline:
- 4 §0 resolutions that hadn't been written into target docs (R1-R4) — applied.
- 11 sections in the original v5 draft that were stale — marked superseded (in `v5-design-original.md`).
- 6 component-API conflicts — reconciled.
- Phase-ID collisions across 4 docs — renumbered.

---

# Appendices

## Appendix A — v4 Screen → v5 Home (full consolidation map)

See §24.4.

## Appendix B — Orphaned API → UI home

| API | v4 status | v5 home |
|-----|-----------|---------|
| `ufsFsck` | No UI | Console → Tools (Files deep-links here, §7.9). |
| `appdbQuery` | No UI | Console → Tools (Files deep-links here, §7.9). |
| `crcCompute` | Hidden in shell | Files toolbar (Game Hub → Storage deep-links). |
| `blake3Compute` | No UI | Files toolbar. |
| `procModulesGet` | No UI | Console → Processes + Files virtual path `🐾 /proc/modules`. |
| `netInterfacesGet` | No UI | Console → Network + Files virtual path `🐾 /net/ifaces`. |
| `syslog/tail` | No UI | Files virtual path `🐾 syslog` (tail mode). |
| `time/timezone` | No UI | Console → Tools. |

## Appendix C — FTX2 frame type allocation (v4.3)

| Range | Use |
|-------|-----|
| 176-183 | Backup |
| 188-191 | Remote Play |
| 196-197 | Fan curve |
| 198-199 | Notification list |
| 200-213 | Cheats |
| 214-219 | SDK Changer |
| 222-223 | TMDB Fetch |
| 224-227 | FTP |
| 228-229 | TMDB Store |
| 232-233 | Firmware Spoof |
| 240-241 | Notification send (stub — proto defines it, no payload/engine impl) |
| 246-247 | Fan curve get |

**SMB has NO frame types** — it's handled entirely host-side by the engine
proxying to the PS5's SMB client.

## Appendix D — State ownership map

| Store | Owner | Persistence | Backed by |
|-------|-------|-------------|-----------|
| `rosterStore` | client | localStorage + Tauri store | user-defined |
| `themeStore` | client | localStorage + Tauri store | user-defined |
| `userConfigStore` (settings) | client | localStorage + Tauri store | user-defined |
| `taskStore` | client | localStorage | engine `jobs` map (reconciled on restart) |
| `telemetryStore` | client | in-memory only | SSE stream |
| `gamesStore` (grid) | client | in-memory cache | `GET /api/games` |
| `gameHubStore` (per-game) | client | in-memory cache | per-game endpoints |
| `fsClipboardStore` | client | in-memory only | user action |
| `fsBookmarksStore` | client | localStorage + Tauri store | user-defined |
| `backStackStore` (mobile) | client | in-memory only | navigation events |
| `alertStore` | client | localStorage | engine alert state |
| `historyStore` (Tasks → History) | client | virtual | union of 7 origin stores (§10.7) |
| `jobs` map | engine | in-memory (rebuilt on restart) | Task payloads |
| `fs/op-status` | engine | in-memory | FS op events |
| `pkg/install-status` | engine | in-memory | bgft events |
| `activity` | engine | sqlite | user actions |
| `auditLog` | engine | sqlite | auditable events |
| `logs` | engine | ring buffer | app + engine logs |
| `gameActivity` | engine | sqlite | play sessions |

## Appendix E — Glossary

| Term | Definition |
|------|------------|
| **Task** | The unified envelope for any long-running operation (§10). |
| **Game Hub** | The per-game 8-tab surface at `/games/:title_id` (§6). |
| **LKG** | Last Known Good — the most recent cheat profile that launched successfully (§6.3.1). |
| **Location** | A filesystem source in Files: PS5, FTP, SMB, or Local (§7.2). |
| **View mode** | A rendering mode in Files: list, grid, tree, disk-usage, search (§7.3). |
| **Drawer** | Secondary navigation surface for Settings, Help, About, Roster (§3.4). |
| **Pipeline** | A composite Task chaining multiple steps with conditional logic (§10.4). |
| **Telemetry stream** | The single SSE feed pushing canonical-path events (§11). |
| **Capability** | A firmware-gated feature flag (`fan-control`, `fw-spoof`, etc.) (§16.1). |
| **Roster** | The list of known PS5s (§14.1). |
| **Critical toast** | The single error-class toast tone, reserved for Task System §10.6 critical alerts (§12.3). |
| **WCAG 2.2 AA** | The conformance target for accessibility (§20.1). |
| **Spotlight** | The Games-tab hero / Command Palette combobox component (§22.21). |
| **Backstack** | The typed mobile hardware-back-button stack (§18.3). |

---

*End of v5 master specification. For deep-dive mockups and edge-case
walkthroughs, see the sub-doc index at the top of this file.*
