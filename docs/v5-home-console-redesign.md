# ps5upload v5.0 — Home Tab & Console Tab (Revised Design)

> **Scope.** This document revises §3.1 (Home), §3.4 (Console), §4-C
> (Backup smart suggestions), §4-D (Thermal Dashboard), and Appendix B
> rows for the 14 v4 screens that collapse into these two tabs. It is
> the plan of record for the Home and Console surfaces.
>
> **Status:** PLANNING — no code written yet. Grounded in:
> - **Home sources:** `Dashboard` (358 LOC), `Connection` (1477 LOC +
>   `PowerControl` 241 + `BringUpPanel` 132), `Payloads` (63 +
>   `CatalogPanel` 814 + `SendPanel` 742 + `PlaylistsPanel` 1219 +
>   `UsbAutoloaderModal` 406)
> - **Console sources:** `Hardware` (1425 + 5 subpanels), `Processes`
>   (569), `FanCurve` (248), `RemotePlay` (336), `Notifications` (184),
>   `Profile` (824), `FtpServer` (201), `NanoDns` (224), `Shell` (311),
>   `FwSpoof` (173), `Backup` (346)
> - **Stores:** `connection.ts` (267), `roster.ts` (432),
>   `notifications.ts` (209), `payloadPlaylists.ts` (474),
>   `bringUp.ts` (128), `runningApps.ts` (69)
> - **Engine routes:** all 134 (see §12 of `lib.rs`)
> - **Tauri commands:** `diagnostics.rs`, `probes.rs`, `payloads.rs`,
>   `ps5_engine.rs`, `process_mgr.rs`, `local_fs.rs`
>
> **References:** `v5-design.md` (parent), `v5-task-system.md` (Tasks
> tab + telemetry stream + alerts + automation), `v5-file-browser-
> redesign.md` (Files tab), `game-hub-revised-design.md` (Games tab).

---

## Table of Contents

0. [Gap-to-Section Index](#0-gap-to-section-index)
1. [Design Principles for Home & Console](#1-design-principles-for-home--console)
2. [Home Tab — Layout](#2-home-tab--layout)
3. [Home — Connection Card](#3-home--connection-card)
4. [Home — Payload Management](#4-home--payload-management)
5. [Home — Dashboard Widgets](#5-home--dashboard-widgets)
6. [Home — First-Run & Empty States](#6-home--first-run--empty-states)
7. [Console Tab — Layout](#7-console-tab--layout)
8. [Console — Thermal Dashboard](#8-console--thermal-dashboard)
9. [Console — Power & Battery](#9-console--power--battery)
10. [Console — Processes](#10-console--processes)
11. [Console — Network Services](#11-console--network-services)
12. [Console — Firmware & System Info](#12-console--firmware--system-info)
13. [Console — Notifications Inbox](#13-console--notifications-inbox)
14. [Console — Profile & Users](#14-console--profile--users)
15. [Console — Remote Play](#15-console--remote-play)
16. [Console — Backup & Restore](#16-console--backup--restore)
17. [Console — Shell](#17-console--shell)
18. [Console — Alerts](#18-console--alerts)
19. [Mobile-Specific Design](#19-mobile-specific-design)
20. [Offline Behavior](#20-offline-behavior)
21. [Data Flows & State](#21-data-flows--state)
22. [Migration & Screen Consolidation](#22-migration--screen-consolidation)
23. [Cross-References to Other Tabs](#23-cross-references-to-other-tabs)
24. [Phased Implementation](#24-phased-implementation)

---

## 0. Gap-to-Section Index

Every audit finding that touches Home or Console maps to a section.

| # | Finding | Section |
|---|---------|---------|
| H1 | Dashboard is read-only with no actions | §5 (widgets become live, actionable) |
| H2 | Connection flow is its own screen — users must navigate to it | §3 (Connection becomes a Home card, always present) |
| H3 | No "Continue playing" / quick-launch from Home | §5.3 |
| H4 | No "Recommended actions" / smart suggestions on Home | §5.5 |
| H5 | No recent-activity jump-links from Home | §5.4 |
| H6 | Payload management is 4 sub-tabs buried behind a sidebar entry | §4 (unified Payload manager, first-class) |
| C1 | Fan curve + temps + power are 3 screens with no feedback loop | §8 (Thermal Dashboard — one view, live curve) |
| C2 | Power telemetry (operating hours, boot cycles) buried in a subpanel | §9 (first-class Power section) |
| C3 | Processes can kill but can't see memory/CPU detail per process | §10 (enhanced process table) |
| C4 | FTP / nanoDNS / Shell / Remote Play are scattered | §11, §15, §17 (Network Services + Shell + Remote Play grouped) |
| C5 | Firmware spoof is read-only with no action | §12 (status + action) |
| C6 | Notifications are a flat read-only list with no filtering | §13 (filterable, actionable, alert-integrated) |
| C7 | Profile avatar/username is a full screen — too much weight | §14 (section within Console) |
| C8 | Backup has no smart suggestions ("23 games with unbacked-up saves") | §16 (Smart Backup) |
| C9 | No alerts/thresholds surfaced on Console tab | §18 (Alerts section, cross-ref Task System §7) |
| C10 | No system info summary (kernel, SDK, payload version in one place) | §12 (System Info card) |
| C11 | nanoDNS save requires payload reload — no warning | §11.2 (reload prompt inline) |
| C12 | Speed test and network interfaces are subpanels — undiscoverable | §11.3, §12 (promoted) |
| O1 | Orphaned API `syslog/tail` — no UI | §12 (System Info → syslog viewer) |
| O2 | Orphaned API `time/state/get\|set` — no UI | §12 (System Info → clock) |
| O3 | Orphaned API `netInterfacesGet` — no UI | §12 (Network section) |
| O4 | Orphaned API `procModulesGet` — no UI | §10 (Processes → modules) |
| O5 | Orphaned API `ufsFsck` — no UI | §11.4 (Tools → fsck) |
| O6 | Orphaned API `appdbQuery` — no UI | §11.4 (Tools → app.db console) |
| O7 | Orphaned APIs `crc32File`, `fsBlake3Hash` — no UI on Console | (moved to Files tab per File Browser §10.2) |
| R1 | Hardware + Processes + FanCurve = 3 screens → Console sections | §7, §8, §10 |
| R2 | FTPServer + NanoDns → Console → Network Services | §11 |
| R3 | Backup stays Console-level (system context, not game) | §16 |

---

## 1. Design Principles for Home & Console

The Home and Console tabs answer two different questions. Every layout
decision flows from keeping them distinct.

| Tab | Question it answers | Mood | Update cadence |
|-----|---------------------|------|----------------|
| **Home** | "What do I want to do right now?" | Launchpad — glanceable, actionable, personal | Static widgets + live status chips |
| **Console** | "How is my PS5 doing, and how do I configure it?" | Cockpit — dense, technical, instrument-grade | Live telemetry stream + on-demand actions |

**Six principles specific to these tabs:**

1. **Home is the start, not the dashboard.** A returning user lands here.
   The first thing they see must be: (a) is my PS5 connected? (b) what
   was I doing? (c) what can I do next? — in that order, above the fold.

2. **Connection state is ambient.** The user never has to visit a
   "Connection screen" to see if they're connected — the status is
   always visible in the header, on Home, and in the status bar. The
   Connection *flow* (send payload) only appears when needed.

3. **Console tab is live, not polled.** Per `v5-task-system.md §8.1`,
   one telemetry SSE stream feeds the Thermal Dashboard, status bar,
   and alert evaluator. The polling storm from v4's Hardware screen
   (6 concurrent polls) is eliminated.

4. **Destructive actions are never one-tap.** Power off, reboot,
   standby, factory-reset fan curve, delete user, delete backup, fsck,
   restore-over-live — all require a confirmation, and the most
   dangerous require typing the console name or a long-press.

5. **Group by user intent, not by API.** FTP + nanoDNS + Speed Test +
   Network Interfaces are "Network Services" because the user thinks
   "network", not "FTP server vs DNS proxy vs bandwidth test". Fan
   curve + temps + fan threshold are "Thermal" because the user thinks
   "cooling", not "sensor endpoint vs curve endpoint".

6. **No orphans.** Every engine + Tauri API surface that exists today
   gets a UI home. If it's not important enough for a visible UI, it's
   reachable from a "Tools" overflow within the relevant Console
   section — but it is reachable.

---

## 2. Home Tab — Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Home                                                                │
│                                                                      │
│  ┌─ Connection ───────────────────────────────────────────────────┐  │
│  │  ● PS5 Pro · 192.168.86.100 · payload v4.3.2 · FW 9.60         │  │
│  │  Connected · ucred elevated · 2h 14m uptime                     │  │
│  │  [⚙ Manage payloads ▾]  [↻ Reconnect]  [⏻ Power ▾]            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Continue playing ──────┐  ┌─ Quick actions ──────────────────┐  │
│  │  [cover] Astro's Playroom│  │  [↑ Upload]      [📦 Install PKG]│  │
│  │  CUSA00506 · 42h         │  │  [💾 Backup]     [📥 Send payload]│  │
│  │  Last: 2 days ago        │  │  [🖥 FTP on/off]  [⚙ Settings]    │  │
│  │  [▶ Launch] [Open Hub →] │  │                                  │  │
│  └──────────────────────────┘  └──────────────────────────────────┘  │
│                                                                      │
│  ┌─ At a glance ──────────────────────────────────────────────────┐  │
│  │  62°C CPU   35% Fan   85 W   245 GB free   ● Astro's Playroom  │  │
│  │  (from telemetry stream — always live, no poll)                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Recent activity ────────────────  [View all → Tasks] ─────────┐  │
│  │  ✓ 2 min ago   Upload complete  /data/themes/dark.css   14 KiB │  │
│  │  ✓ 18 min ago  Backup snapshot "pre-FW12"              8.4 GB  │  │
│  │  ⚠ 1 h ago     Install rejected  Rogue.pkg (DRM)               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Recommended ──────────────────────────────────────────────────┐  │
│  │  💾 23 games with unbacked-up saves              [Backup all →]│  │
│  │  📦 2 PKGs in your library ready to install      [Install →]   │  │
│  │  🔥 Fan curve not set (stock)                    [Configure →] │  │
│  │  🎮 4 games with available updates               [View →]      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Notifications ────────────────────  [View all → Console] ─────┐  │
│  │  • 14:32  Backup completed for Astro's Playroom                │  │
│  │  • 14:18  Thermal alert: CPU 87°C (resolved)                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Widget system

Home is composed of **widgets**, each a self-contained card with:
- A title and (optional) "View all →" deep link to a relevant tab
- A data source (store, API, or telemetry slice)
- An empty state, loading state, and error state
- No required order — users drag to reorder, settings persist

**Default widget order** (first run):
1. **Connection** — always present, pinned, not removable
2. **Continue playing** — most-recently-played game
3. **Quick actions** — the 6 most common entry points
4. **At a glance** — live telemetry summary
5. **Recent activity** — last 5 tasks (from Tasks store, via Activity)
6. **Recommended** — smart suggestions (§5.5)
7. **Notifications** — last 3 unread

**Customization:** users can hide widgets they don't care about, but
Connection and At a glance are always visible. Order persists per
roster (each console can have a different Home layout if desired, or
one global layout — a setting).

### 2.2 Landing logic

Per `v5-task-system.md §3.4`, the app opens to:
- **Tasks → Active** if any tasks are running or paused
- **Home** otherwise

Within Home, the scroll position is top — the Connection card is
always the first thing visible, because nothing else works without it.

---

## 3. Home — Connection Card

Replaces the standalone `Connection` screen (1477 LOC) for status
display. The full send-payload flow becomes a modal launched from this
card's "Send payload" button.

### 3.1 Connected state

```
┌─ Connection ───────────────────────────────────────────────────────┐
│  ● PS5 Pro · 192.168.86.100                                         │
│  payload v4.3.2 (latest) · FW 9.60 · kernel 9.6.0 · ucred elevated  │
│  Connected 2h 14m · last redeploy 3 days ago                        │
│                                                                     │
│  [⚙ Manage payloads ▾]  [↻ Reconnect]  [⏻ Power ▾]  [⋯]           │
└─────────────────────────────────────────────────────────────────────┘
```

**Fields:**
| Field | Source | Notes |
|---|---|---|
| Console name + host | `useRosterStore.activeProfile` | Click to copy host. |
| Payload version | `useConnectionStore.payloadVersion` | "(latest)" if matches catalog; "(update available)" otherwise with a "Update" button. |
| Firmware | `parsePS5Firmware` from `ps5Kernel` | Drives "FW required" checks on games. |
| Kernel | `useConnectionStore.ps5Kernel` | |
| ucred | `useConnectionStore.ucredElevated` | If false: amber dot + "Not elevated — some features unavailable" + "Re-send payload" button. |
| Uptime | from `powerTelemetryGet` `operating_seconds` | Formatted. |
| Last redeploy | from `send_payload_history.json` (existing) | |

**Actions (all in the card):**
- **⚙ Manage payloads ▾** — opens the Payload Manager (§4).
- **↻ Reconnect** — re-probes the loader port, re-sends payload if
  needed. Runs the existing `pollUntilReady` flow in a modal.
- **⏻ Power ▾** — dropdown: Standby, Restart, Shutdown. Each opens a
  confirm dialog (existing `PowerControl` logic, relocated).
- **⋯** overflow: "Edit console" (roster settings), "Forget this
  console" (removes from roster), "Switch console" (roster picker).

### 3.2 Disconnected state

When the console is unreachable (per `v5-task-system.md §10.2`
disconnect watcher), the card transforms:

```
┌─ Connection ───────────────────────────────────────────────────────┐
│  ○ PS5 Pro · 192.168.86.100  — DISCONNECTED                        │
│                                                                     │
│  Last seen 4 min ago. Payload may have crashed, or PS5 is off /     │
│  in rest mode.                                                      │
│                                                                     │
│  [↻ Retry connection]   [📤 Wake via LAN]   [⚙ Manage payloads]    │
└─────────────────────────────────────────────────────────────────────┘
```

- "Retry connection" re-probes every 5s with a spinner.
- "Wake via LAN" sends a WoL magic packet (existing capability).
- The card stays red/amber until connected.
- If the user has **no consoles in the roster**, the card shows the
  first-run wizard (§6.1).

### 3.3 Send-payload flow (modal)

When the user clicks "Send payload" (from Connection card, Quick
actions, or ⌘K), a modal opens with the existing 3-step flow:

```
┌─ Send payload — PS5 Pro ───────────────────────────────────────────┐
│                                                                     │
│  Step 1: PS5 IP                                                    │
│    [192.168.86.100         ]   [Discover ▾]                         │
│                                                                     │
│  Step 2: Probe loader (port 9021)                                  │
│    ✓ Loader reachable · FW 9.60                                     │
│                                                                     │
│  Step 3: Choose payload                                            │
│    (•) Bundled: ps5upload-helpers v4.3.2 (recommended)             │
│    ( ) Catalog: [select from list ▾]                               │
│    ( ) Custom file: [Choose .elf/.bin…]                            │
│                                                                     │
│    Payload features: FTP, cheats, fan control, saves, backup       │
│                                                                     │
│              [Cancel]    [Send payload]                             │
└─────────────────────────────────────────────────────────────────────┘
```

This is the existing `Connection` screen's logic, repackaged as a
modal. The `BringUpPanel` (cold-boot orchestration) becomes an option
here too: "Bring up from cold boot" expands to show the pre-helper →
helper → post-helper chain (existing `useBringUpStore`).

### 3.4 What disappears

The standalone `Connection` **screen** (route `/connection`) is
removed. Its functionality lives in:
- **Connection card** (status display) — always on Home
- **Send-payload modal** (the flow) — launched from anywhere
- **Power menu** — dropdown in the card
- **Console selector** (roster picker) — global header

Old route `/connection` redirects to `/` (Home).

---

## 4. Home — Payload Management

The v4 `Payloads` screen (63 LOC shell + 4 panels totalling ~3181 LOC)
is far too heavy for a sidebar entry. v5 promotes the most-used actions
to Home and files the rest under a "Manage payloads" modal.

### 4.1 The Payload Manager modal

Launched from Home → Connection card → "⚙ Manage payloads ▾". A
modal with 3 tabs:

```
┌─ Payload Manager ──────────────────────────────────────────────────┐
│                                                                     │
│  [Catalog]  [Send custom]  [Playlists]                             │
│                                                                     │
│  ── Catalog ──                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ ps5upload-helpers  v4.3.2  ✓ installed  [Send] [Release notes]│  │
│  │ GoldHEN            v2.4b2           [Download] [Send]         │  │
│  │ etaHEN             v1.2             [Download] [Send]         │  │
│  │ ...                                                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  [+ Add custom repo]                                                │
│                                                                     │
│  Filter: [All ▾]  [Search...]                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Tab 1: Catalog** (`CatalogPanel.tsx`, 814 LOC → consolidated)
- Lists `payloadsCatalog` (existing API). Per-row: name, version,
  installed/download/Send buttons, release notes expand.
- "Add custom repo" (existing `payloadsAddCustomRepo`).
- Send → opens the send-payload modal (§3.3) pre-filled with this payload.

**Tab 2: Send custom** (`SendPanel.tsx`, 742 LOC → consolidated)
- File picker (.elf/.bin/.js/.lua/.jar), probe-then-send, recent-sends
  history (existing `send_payload_history.json`).
- "Send" runs the existing flow.

**Tab 3: Playlists** (`PlaylistsPanel.tsx`, 1219 LOC → consolidated)
- Create/edit/run payload playlists (existing
  `usePayloadPlaylistsStore`).
- "New playlist", drag-reorder steps, run/cancel.
- "USB Autoloader" is a button here (existing `UsbAutoloaderModal`,
  406 LOC) — generates a USB stick with `autoload.txt`.

### 4.2 Quick-send from Home

The Connection card's "Send payload" button (and the Quick Actions
widget's "Send payload") opens the send-payload modal directly,
defaulting to the bundled payload. This is the 90% case.

### 4.3 What disappears

The standalone `Payloads` screen (route `/payloads`) is removed. Old
route redirects to `/` with the Payload Manager modal auto-opened.

---

## 5. Home — Dashboard Widgets

### 5.1 At a glance (live telemetry)

A compact horizontal strip fed by the **telemetry SSE stream**
(`v5-task-system.md §8.1`), replacing v4 Dashboard's 5s polling:

```
┌─ At a glance ──────────────────────────────────────────────────────┐
│  62°C CPU   35% Fan   85 W   245 GB free   ● Astro's Playroom      │
│                                                  [Console →]        │
└─────────────────────────────────────────────────────────────────────┘
```

- Each value is clickable → Console tab, relevant section (temp →
  Thermal, storage → System Info, running app → Game Hub).
- Color: temp > 80°C = red, > 70°C = amber; fan ≥ 90% = amber; storage
  < 20 GB = red, < 50 GB = amber.
- If no telemetry stream (disconnected), shows "—" with the last-known
  value dimmed + a clock icon ("last seen 4m ago").

### 5.2 Quick actions

Six large (≥ 44×44px) buttons:

```
┌─ Quick actions ─────────────────────────────────────┐
│  [↑ Upload]      [📦 Install PKG]                   │
│  [💾 Backup]     [📥 Send payload]                  │
│  [🖥 FTP on/off]  [⚙ Settings]                      │
└─────────────────────────────────────────────────────┘
```

| Button | Action | Destination |
|--------|--------|-------------|
| Upload | Opens Files tab in upload mode | Files |
| Install PKG | Opens the install dialog | Games or Files |
| Backup | Opens Console → Backup section | Console |
| Send payload | Opens send-payload modal (§3.3) | Modal |
| FTP on/off | Toggles FTP server immediately | Console → Network |
| Settings | Opens settings drawer | Drawer |

- "FTP on/off" is a toggle — if FTP is running, it reads "FTP on" with
  a green dot; clicking stops it.
- On mobile, these become a 2×3 grid that fills the width.

### 5.3 Continue playing

Shows the most-recently-played game (from `activity.json` / Play Time
store):

```
┌─ Continue playing ─────────────────┐
│  [cover]  Astro's Playroom         │
│  CUSA00506 · Played 42h            │
│  Last: 2 days ago                  │
│  [▶ Launch]  [Open Hub →]          │
└─────────────────────────────────────┘
```

- Cover art from `/api/ps5/app-icon?title_id=`.
- "Launch" uses `ps5_app_launch` directly (no need to visit Games).
- "Open Hub" → `/games/CUSA00506` (Game Hub).
- If no games played yet: "Play a game to see it here" empty state.
- If the last-played game is currently running: shows "● Now playing"
  with a "Game Hub" link instead of Launch.

### 5.4 Recent activity

Last 5 terminal tasks (from the unified Tasks store, joined with
Activity). Each row is clickable → the origin screen or the relevant
Hub/Tasks row:

```
┌─ Recent activity ──────────────────  [View all → Tasks] ─┐
│  ✓ 2 min ago   Upload complete  /data/themes/dark.css   │
│  ✓ 18 min ago  Backup "pre-FW12"              [Restore] │
│  ⚠ 1 h ago     Install rejected  Rogue.pkg    [Retry ▾] │
│  ✓ 3 h ago     Cheat download  GoldHEN                   │
│  ⚠ Yesterday   Upload failed  /saves/CUSA00506 [Resume] │
└──────────────────────────────────────────────────────────┘
```

- Row actions mirror the Tasks tab row actions (`v5-task-system.md
  §3.3`): failed → Retry dropdown, done-backup → Restore,
  done-install → Open Game Hub.
- "View all → Tasks" deep-links to the Tasks tab.

### 5.5 Recommended (smart suggestions)

The highest-leverage widget for making the app feel intelligent.
Rules-based, computed from existing stores:

```
┌─ Recommended ──────────────────────────────────────────┐
│  💾 23 games with unbacked-up saves      [Backup all →]│
│  📦 2 PKGs in your library ready to install  [Install→]│
│  🔥 Fan curve not set (stock)            [Configure →] │
│  🎮 4 games with available updates        [View →]     │
│  ⚠ Payload update available (v4.3.3)     [Update →]   │
└────────────────────────────────────────────────────────┘
```

**Rules** (each fires if its condition holds; sorted by priority):
1. **Unbacked-up saves**: count of installed games where
   `saves.last_backup` is null or > 7 days. Action → Console → Backup
   with scope=saves-only.
2. **Installable PKGs**: count of `gd` category PKGs in `pkgLibrary`
   not in installed set. Action → Games grid (filtered).
3. **Fan curve not set**: if `fan_curve_get` returns the stock curve
   (heuristic: < 3 points) and temps have ever exceeded 75°C. Action →
   Console → Thermal.
4. **Game updates available**: count of installed games with a newer
   `gp` PKG in the library. Action → Games grid (filtered).
5. **Payload update available**: bundled payload version < catalog
   version. Action → send-payload modal.
6. **Storage low**: if internal free < 50 GB. Action → Files →
   disk-usage view.
7. **Thermal incidents**: if AlertLog has a critical thermal event in
   the last 24h. Action → Console → Alerts.

- Each suggestion is dismissible; dismissed ones don't reappear for
  7 days (unless the condition worsens).
- If nothing applies, the widget hides entirely (no "you're all
  caught up" noise).

### 5.6 Notifications

Last 3 unread from `useNotificationsStore`, plus alerts that have
fired:

```
┌─ Notifications ──────────────────────  [View all → Console] ─┐
│  • 14:32  Backup completed for Astro's Playroom              │
│  🔥 14:18  Thermal alert: CPU 87°C (resolved)                │
│  • 13:55  Payload re-deployed (v4.3.2)                       │
└──────────────────────────────────────────────────────────────┘
```

- Severity-colored: info (•), warn (⚠ amber), critical (🔥 red).
- Click → Console → Notifications (filtered to that entry) or the
  relevant task.

---

## 6. Home — First-Run & Empty States

### 6.1 First-run wizard (no consoles)

When the roster is empty, the Home tab is the wizard:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Welcome to ps5upload                                                │
│                                                                      │
│  Let's connect to your PS5.                                          │
│                                                                      │
│  ┌─ Connection ─────────────────────────────────────────────────┐    │
│  │  PS5 IP address:  [192.168.86.100    ]   [🔍 Discover]      │    │
│  │                                                              │    │
│  │  [Connect →]                                                 │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  How it works:                                                       │
│    1. Enter your PS5's IP (Settings → Network on the PS5)            │
│    2. We probe the loader port (9021) and send the payload           │
│    3. Once connected, you can upload, install, backup, and more      │
│                                                                      │
│  First time? [Read the setup guide →]                                │
└──────────────────────────────────────────────────────────────────────┘
```

This is the existing first-run flow, integrated into Home rather than
a separate screen. The existing `FirstRun.tsx` onboarding wizard
stays for feature-tour purposes but is triggered only after the first
successful connection.

### 6.2 No games installed

After connection, if `library` returns zero titles:

```
┌─ Continue playing ─────────────────┐
│  No games yet                       │
│  Install a PKG to get started.      │
│  [📦 Install PKG →]                 │
└─────────────────────────────────────┘
```

### 6.3 No recent activity

If there are zero tasks ever:

```
┌─ Recent activity ──────────────────┐
│  Nothing yet.                       │
│  Your transfers and installs will   │
│  appear here.                       │
└─────────────────────────────────────┘
```

---

## 7. Console Tab — Layout

The Console tab is a **cockpit** — dense, technical, organized into
sections. Desktop uses a left rail of section links; mobile uses
horizontally swipeable sections.

### 7.1 Desktop layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Console — PS5 Pro                                                   │
│                                                                      │
│  ┌─ Alert banner (if any) ───────────────────────────────────────┐  │
│  │  🔥 CPU at 87°C for 12s — uploads paused    [Resume] [×]      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────┬─────────────────────────────────────────────────┐  │
│  │ SECTIONS     │                                                 │  │
│  │              │                                                 │  │
│  │ 🌡️ Thermal   │   (selected section content)                   │  │
│  │ ⚡ Power      │                                                 │  │
│  │ 📊 Processes │                                                 │  │
│  │ 🌐 Network   │                                                 │  │
│  │ 🔧 Firmware  │                                                 │  │
│  │ 🔔 Notifs    │                                                 │  │
│  │ 👤 Profile   │                                                 │  │
│  │ 🎮 Remote Play│                                                │  │
│  │ 💾 Backup    │                                                 │  │
│  │ 🖥️ Shell     │                                                 │  │
│  │ ⚠️ Alerts    │                                                 │  │
│  │ 🧰 Tools     │                                                 │  │
│  │              │                                                 │  │
│  └──────────────┴─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

- Left rail: 12 sections, icon + label, keyboard-shortcutable
  (Alt+1..9, Alt+0, Alt+-). Sticky, always visible.
- Section content: scrollable. Each section is a self-contained card
  or set of cards.
- The alert banner is sticky at the top of the content area — it
  appears only when there's an active alert.

### 7.2 Section list

| # | Section | Icon | Closes gaps | Source screens |
|---|---------|------|-------------|----------------|
| 1 | Thermal | 🌡️ | C1 | Hardware + FanCurve |
| 2 | Power & Battery | ⚡ | C2 | Hardware/PowerTelemetryPanel |
| 3 | Processes | 📊 | C3, O4 | Processes |
| 4 | Network Services | 🌐 | C4, C11, C12, O3 | FtpServer + NanoDns + (Speed Test, Net Interfaces) |
| 5 | Firmware & System | 🔧 | C5, C10, O1, O2 | FwSpoof + (syslog, time, system info) |
| 6 | Notifications | 🔔 | C6 | Notifications |
| 7 | Profile & Users | 👤 | C7 | Profile |
| 8 | Remote Play | 🎮 | C4 | RemotePlay |
| 9 | Backup & Restore | 💾 | C8 | Backup |
| 10 | Shell | 🖥️ | C4 | Shell |
| 11 | Alerts | ⚠️ | C9 | (new — Task System §7) |
| 12 | Tools | 🧰 | O5, O6 | (new — fsck, app.db, etc.) |

### 7.3 Mobile layout

- Sections become a **horizontal swipeable strip** at the top (below
  the alert banner), similar to the Game Hub tab strip.
- The strip scrolls: `[🌡️] [⚡] [📊] [🌐] [🔧] [🔔] [👤] [🎮] [💾] [🖥️] [⚠️] [🧰]`
- Active section is underlined. Swipe left/right changes section.
- Each section's content is touch-optimized (§19).

---

## 8. Console — Thermal Dashboard

**Closes C1, R1.** Merges Hardware (temps/power/fan) + FanCurve into
one live view with a feedback loop. This is the headline Console
feature.

### 8.1 Layout

```
┌─ Thermal Dashboard ─────────────────────────────────────────────────┐
│                                                                      │
│  ┌─ Live readings ─────────────────────────────────────────────────┐│
│  │  CPU    62°C   ████████░░░░  (threshold 85°C)                    ││
│  │  SoC    58°C   ███████░░░░░  (threshold 85°C)                    ││
│  │  Board  45°C   █████░░░░░░░                                    ││
│  │  Fan   1850 RPM  35% duty   ██████░░░░░░░░░░░  (threshold 70°C) ││
│  │  Power  85 W                                                     ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─ Fan curve editor ──────────────────────────────────────────────┐│
│  │  100% │                              ●────●──●  (drag points)   ││
│  │       │                                         points: (30°C,  ││
│  │   50% │                                   ●      20%), (60°C,  ││
│  │       │                          ●              40%), (70°C,  ││
│  │    0% │───●───────────────────                  70%), (85°C,  ││
│  │       └──┬───┬───┬───┬───┬───┬───┬───┬── temp °C 100%)        ││
│  │          0  20  40  60  80  100 120 140                        ││
│  │                                                                  ││
│  │  [Reset to stock]  [Apply curve]   Last applied: 3 days ago     ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─ Quick threshold ───────────────────────────────────────────────┐│
│  │  Fan kicks in at:  [70] °C   [Apply]                            ││
│  │  (Sets a single-point curve. Advanced users use the editor.)    ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─ Live graph (last 15 min) ──────────────────────  [Expand →] ──┐│
│  │  CPU temp ─────────────╱╲────── 62°C                             ││
│  │  Fan duty ─────────────────────  35%                             ││
│  │  (from telemetry ring buffer — same data as Tasks → Telemetry)  ││
│  └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 Data sources (all from the telemetry stream)

Per `v5-task-system.md §8`, the telemetry SSE pushes every 2s:
```json
{"temps":{"cpu":62,"soc":58,"board":45}, "fan":{"rpm":1850,"duty":35}, "power":{"draw":85}}
```

No polling. The Thermal Dashboard subscribes to the stream and renders
the latest snapshot. The 15-min graph reads from the telemetry ring
buffer (`v5-task-system.md §8.2`).

### 8.3 Fan curve editor

- **Interactive drag-points** on an SVG chart. Each point is a
  `(temp_c, duty_pct)` pair. Existing `fanCurveSet(addr, points)` API.
- Drag a point → curve updates in real-time (live preview).
- "Apply curve" sends to the PS5 via `fan_curve_set`. Confirmation
  required only if any point exceeds 90% duty (safety).
- "Reset to stock" restores the default 4-point curve.
- Threshold lines from active AlertRules (Task System §7) render as
  dashed horizontal lines — the user sees exactly where the alert will
  fire.
- **Touch mode** (§19.1): points have a 44px hit area; dragging uses
  a larger "grab handle" that appears on touch-start.

### 8.4 What it replaces

- `Hardware/index.tsx` (1425 LOC) → thermal portion moves here
- `Hardware/PowerTelemetryPanel.tsx` → Power section (§9)
- `Hardware/PeripheralPanel.tsx` → System Info (§12.4)
- `Hardware/SpeedTestPanel.tsx` → Network (§11.3)
- `Hardware/NetworkPanel.tsx` → Network (§11.4)
- `FanCurve/index.tsx` (248 LOC) → fan curve editor here

Net: ~1650 LOC of v4 screens → one Thermal section.

### 8.5 Alert integration

When a thermal alert fires (CPU > 85°C for 10s, per Task System §7.3):
- The alert banner appears at the top of Console.
- The Thermal Dashboard's CPU temp turns red.
- The graph shows a vertical alert marker at the firing timestamp.
- "Uploads paused" indicator if the alert action paused tasks.
- When temp drops below threshold for 60s (cooldown), the alert
  auto-resolves and a "Resume paused tasks?" prompt appears.

---

## 9. Console — Power & Battery

**Closes C2.** Promotes `PowerTelemetryPanel` (139 LOC) to a
first-class section.

### 9.1 Layout

```
┌─ Power & Battery ───────────────────────────────────────────────────┐
│                                                                      │
│  ┌─ Operating stats ──────────────────────────────────────────────┐ │
│  │  Total operating time:   2,847 hours                            │ │
│  │  Boot cycles:            412                                     │ │
│  │  Thermal alert count:    3 (last 30 days)                       │ │
│  │  Last power-up cause:    User power button                      │ │
│  │  Last boot:              2026-08-02 09:14                       │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Current draw ─────────────────────────────────────────────────┐ │
│  │  85 W   (from telemetry stream)                                 │ │
│  │  Voltage: 12.1 V                                                │ │
│  │  Historical avg: 78 W (last 24h)                                │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Power control ────────────────────────────────────────────────┐ │
│  │  [⏻ Power off]  [🌙 Standby]  [↻ Restart]                      │ │
│  │  Each requires confirmation.                                    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 Data sources

- `powerTelemetryGet(addr)` → operating_seconds, boot_cycles,
  thermal_alert_count, power_up_cause, last_boot.
- Telemetry stream → current power.draw, power.voltage.
- `power/control` POST → standby, reboot, shutdown (existing).

### 9.3 Power control safety

- Each action (standby, restart, shutdown) opens a confirm dialog:
  "PS5 Pro will restart. 2 tasks are running — they will be paused.
  [Cancel] [Restart]"
- If tasks are running, the dialog names them and offers "Pause
  tasks then restart" (which pauses via the Task scheduler, waits for
  ack, then sends the power command).
- WoL (Wake on LAN) is available as "Wake via LAN" if the console is
  off — appears in place of the power buttons.

---

## 10. Console — Processes

**Closes C3, O4, R1.** Enhanced version of the v4 Processes screen.

### 10.1 Layout

```
┌─ Processes ─────────────────────────────────────────────────────────┐
│                                                                      │
│  Filter: [● User processes  ○ System]   [Search...]   [⟳ Refresh]   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ PID   Name              Title ID    Memory   Threads   Actions │ │
│  │ ────────────────────────────────────────────────────────────── │ │
│  │ 412  SceShellUI         NPXS21007   128 MB   42       [⋮]     │ │
│  │ 891  Astro's Playroom   CUSA00506   2.1 GB   18       [⋮]     │ │
│  │ ...                                                            │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  47 processes · 2.4 GB used                                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.2 Row actions (kebab menu ⋮)

- **Kill** (user) / **Kill** (system, extra confirm) — `processKill`.
- **Restart** = kill + `appLaunch` by title_id (existing v4 behavior).
- **View modules** — opens a sub-panel listing loaded modules for this
  PID via `procModulesGet(addr, pid)` (closes O4). Shows module name,
  address, size, refcount.
- **Suspend / Resume** (if the app lifecycle API supports it —
  `app_suspend`/`app_resume` from `app_lifecycle.rs`).
- **Open Game Hub** (if the process is a known title_id) → jumps to
  `/games/:title_id`.

### 10.3 Enhancement over v4

- **Memory + thread count** columns (from `processList` — already
  returned, just not displayed in v4).
- **Search** filters by name or title_id.
- **Sort** by any column (click header).
- **Auto-refresh** every 3s (existing), pausable.
- "Currently running" badge links to the Game Hub.

### 10.4 What it replaces

`Processes/index.tsx` (569 LOC) → Console → Processes section, slimmed
to ~300 LOC with the module viewer as a sub-component.

---

## 11. Console — Network Services

**Closes C4, C11, C12, O3, R2.** Groups all network-related features.

### 11.1 FTP Server

```
┌─ FTP Server ────────────────────────────────────────────────────────┐
│                                                                     │
│  Status: ● Running on port 2121   Root: /   Mode: Read-only         │
│                                                                     │
│  Port:      [2121        ]                                          │
│  Root:      [/           ]                                          │
│  Read-only: [● ON]                                                  │
│  Username:  [ps5upload  ]  (blank = anonymous)                      │
│  Password:  [••••••••    ]  (blank = none)                          │
│                                                                     │
│  [▶ Start]  or  [⏹ Stop]                                             │
│                                                                     │
│  Browse via FTP →  (opens Files tab → FTP location)                 │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `ftpStart(addr, {port, root, readonly, user, pass})` and
  `ftpStatus(addr)`.
- "Browse via FTP" deep-links to the Files tab with the FTP location
  selected (per File Browser §3.3).
- This is the **only** place the FTP toggle lives (File Browser §3.3
  references it; the old Console → Network Services duplicate is
  removed).

### 11.2 nanoDNS

```
┌─ nanoDNS ───────────────────────────────────────────────────────────┐
│                                                                     │
│  Edit /data/nanodns/nanodns.ini:                                    │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ [dns]                                                          │ │
│  │ listen=0.0.0.0:53                                              │ │
│  │ ...                                                            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [💾 Save]                                                          │
│                                                                     │
│  ⚠ Changes take effect only after re-loading the payload.           │
│  [Re-send payload →]  (opens send-payload modal)                    │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `fsReadPreview(mgmtAddr)` and `fsWriteText(mgmtAddr)` on
  `/data/nanodns/nanodns.ini` (existing).
- **Reload warning** is now inline and prominent (closes C11) — the v4
  screen buried it in a notification.
- "Re-send payload" deep-links to the send-payload modal.

### 11.3 Speed Test

```
┌─ Speed Test ────────────────────────────────────────────────────────┐
│                                                                     │
│  Rounds: [64 ▾]   [▶ Run test]                                      │
│                                                                     │
│  Last result:  94.2 Mbps down  ·  12.1 Mbps up   (2 min ago)        │
│                                                                     │
│  History:                                                           │
│    14:30   94.2 / 12.1 Mbps                                         │
│    13:15   91.8 / 11.9 Mbps                                         │
│    ...                                                              │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `netSpeedTestRun(addr, rounds)`.
- Promoted from a subpanel (closes C12).

### 11.4 Network Interfaces (closes O3)

```
┌─ Network Interfaces ────────────────────────────────────────────────┐
│                                                                     │
│  Interface   IP            MAC               Link   MTU             │
│  ─────────────────────────────────────────────────────────────────  │
│  en0         192.168.86.100  aa:bb:cc:dd:ee:ff  ● Up   1500          │
│  lo0         127.0.0.1      —                   ● Up   65536         │
│                                                                     │
│  [⟳ Refresh]                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `netInterfacesGet(addr)` (existing Tauri command, no UI in v4).

### 11.5 Tools (closes O5, O6)

A collapsible "Tools" sub-section within Network (or a separate section
if it grows) for network-adjacent power tools:

- **UFS fsck** — `ufs_fsck_run` with 3-tier confirmation (per File
  Browser §14.2). Listed here because it's a storage-layer tool, but
  also linked from System Info.
- **app.db query** — `appdb_query_get` console (per File Browser §14.3).
  Opens a modal with a SQL input + results table.

---

## 12. Console — Firmware & System Info

**Closes C5, C10, O1, O2.** The "about this PS5" section.

### 12.1 System summary card

```
┌─ System Info ───────────────────────────────────────────────────────┐
│                                                                     │
│  PS5 Pro · 192.168.86.100                                           │
│                                                                     │
│  Firmware:      9.60 (system_sw_version)                            │
│  Kernel:        9.6.0                                               │
│  SDK (current): 0x09060000 (9.60)                                   │
│  Payload:       ps5upload-helpers v4.3.2                            │
│  Engine:        v4.3.2                                              │
│  ucred:         ● Elevated                                          │
│                                                                     │
│  ┌─ Firmware spoof ──────────────────────────────────────────────┐  │
│  │  Reported SW version: 9.60 (no spoof active)                  │  │
│  │  Kernel release:      9.6.0                                   │  │
│  │  [Toggle spoof]  (advanced — not commonly needed)             │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

- `fwSpoofStatus(addr)` for the spoof card.
- The v4 FwSpoof screen is read-only; v5 adds a "Toggle spoof" action
  (closes C5) — sets the reported SW version. Confirmation required.

### 12.2 Clock & Timezone (closes O2)

```
┌─ Clock & Timezone ──────────────────────────────────────────────────┐
│                                                                     │
│  PS5 time:     2026-08-02 14:23:01 JST                              │
│  Timezone:     [Asia/Tokyo ▾]                                       │
│  NTP sync:     [● On]                                               │
│                                                                     │
│  [Sync now]  [Apply timezone]                                       │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `time/state/get|set` and `time/sync`.
- "Sync now" fires `time/sync` to NTP.

### 12.3 Syslog viewer (closes O1)

```
┌─ Syslog ────────────────────────────────────────────────────────────┐
│                                                                     │
│  [● Live tail]   [Filter: error warn]   [⤓ Download full log]       │
│                                                                     │
│  14:23:01  [kernel] UFS mount complete                              │
│  14:22:58  [net]    Link up: en0 (1 Gbps)                           │
│  14:22:55  [warn]   Thermal throttle event (CPU 84°C)               │
│  ...                                                                │
│  (auto-scrolls when "Live tail" is on)                              │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `syslog/tail` SSE-style endpoint (existing).
- Filterable by level (error/warn/info/debug).
- "Download full log" fetches the full syslog to a local file.

### 12.4 Peripherals

```
┌─ Peripherals ───────────────────────────────────────────────────────┐
│                                                                     │
│  Blu-ray drive:  ● On    [Turn off]    (power saving)               │
│  Disc:           Ejected              [Eject]                       │
│  USB ports:                                                        │
│    Port 0:  ● On    [Turn off]                                      │
│    Port 1:  ● On    [Turn off]                                      │
└─────────────────────────────────────────────────────────────────────┘
```

- `peripheralEject`, `peripheralBdOff/On`, `peripheralUsbOff/On` —
  existing Tauri commands.
- Promoted from `Hardware/PeripheralPanel.tsx` (149 LOC subpanel).

---

## 13. Console — Notifications Inbox

**Closes C6.** Enhanced version of the v4 Notifications screen.

### 13.1 Layout

```
┌─ Notifications ─────────────────────────────────────────────────────┐
│                                                                     │
│  [All ▾]  [Level: ●Info ○Warn ○Error ○Critical]   [✓ Mark all read] │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ 🔥 14:18  CPU thermal alert: 87°C (resolved at 14:19)         │ │
│  │    Action: uploads paused.  [Resume tasks]                     │ │
│  │ •  14:32  Backup completed for Astro's Playroom                │ │
│  │    [Open Hub →]                                                │ │
│  │ •  13:55  Payload re-deployed (v4.3.2)                         │ │
│  │ ⚠ 12:01  Upload failed: /saves/CUSA00506 (retrying)           │ │
│  │    [View task →]                                               │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  23 total · 4 unread                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.2 Enhancements over v4

- **Filterable** by level (v4 was a flat list).
- **Actionable**: alert notifications have inline actions ("Resume
  tasks", "View task", "Open Hub").
- **Incremental fetch** via `sinceSeq` (existing) — no full refetch.
- **Severity icons + colors** (info •, warn ⚠, error ⚠ red, critical 🔥).
- **Source tagging**: "from PS5" (notif/list) vs "from app" (push
  notifications the app generated) vs "from alert system".

### 13.3 Integration with alerts

Alert-fired notifications (Task System §7) appear here with their
severity and a "resolved" timestamp when the condition clears. They're
also logged to the AlertLog (`v5-task-system.md §7.5`) and visible in
the Alerts section (§18).

### 13.4 OS notification mirroring

The existing `useNotificationsStore` mirrors to the OS notification
center when the app is not foreground. This stays unchanged — the
inbox here is the in-app view of the same data.

---

## 14. Console — Profile & Users

**Closes C7.** Demotes Profile from a full screen to a Console section.

### 14.1 Layout

```
┌─ Profile & Users ───────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ Foreground user ──────────────────────────────────────────────┐ │
│  │  [Avatar]  Username: yunpuy               UID: 0x10000002      │ │
│  │            [Change avatar]  [Rename]                            │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ All users ────────────────────────────────────────────────────┐ │
│  │  ● yunpuy (foreground)    UID 0x10000002   [Rename] [Delete]   │ │
│  │  ○ guest                  UID 0x10000003   [Rename] [Delete]   │ │
│  │  [+ Create user]                                                │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Offline account slots ────────────────────────────────────────┐ │
│  │  Slot 1: Player1   [Rename]                                     │ │
│  │  Slot 2: (empty)   [Set name]                                   │ │
│  │  Slot 3: (empty)   [Set name]                                   │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ⚠ Restart PS5 to see avatar/username changes.                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 14.2 Avatar change flow

Clicking "Change avatar" opens a modal (the existing flow from
`Profile/index.tsx` 824 LOC, packaged as a modal):

```
┌─ Change avatar ─────────────────────────────────────────────────────┐
│                                                                     │
│  Target user: [yunpuy ▾]                                            │
│                                                                     │
│  [Choose image…]  or drag-drop                                      │
│                                                                     │
│  Preview:                                                           │
│  ┌────────┐  Crop mode:  (•) Square   ( ) Fit                       │
│  │ [img]  │                                                          │
│  │        │  [Zoom slider]                                           │
│  └────────┘                                                          │
│                                                                     │
│              [Cancel]    [Apply avatar]                             │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `profileAvatarPreview` (server-side preview) then
  `profileApplyAvatar` (confirm + write).
- Image picker via Tauri `openDialog` (desktop) or Scoped Storage
  picker (mobile).

### 14.3 Keyed on console

Per the v4 fix, all profile state is keyed on `addr` so switching
console fully resets — prevents avatar Apply writing to the wrong uid.
This is preserved in v5.

### 14.4 What it replaces

`Profile/index.tsx` (824 LOC) → Console → Profile section, ~600 LOC
(the modal accounts for most of it).

---

## 15. Console — Remote Play

**Closes C4.** Relocates the RemotePlay screen as a Console section.

### 15.1 Layout

```
┌─ Remote Play ───────────────────────────────────────────────────────┐
│                                                                     │
│  Status: ○ No active session                                        │
│                                                                     │
│  Account ID:  [____________________]  (from PSN)                    │
│                                                                     │
│  [▶ Request session]                                                │
│                                                                     │
│  ┌─ Session details (when active) ────────────────────────────────┐ │
│  │  PIN:        1234  [Copy]                                       │ │
│  │  Account:    0123456789abcdef  [Copy chiaki format]             │ │
│  │  Chiaki:     1234-5678-9abc                                     │ │
│  │  [Cancel session]                                               │ │
│  └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `remoteplayRequest`, `remoteplayStatus`, `remoteplayCancel`.
- `accountIdToChiakiNumeric` conversion (existing).
- Auto-refreshes status.

### 15.2 What it replaces

`RemotePlay/index.tsx` (336 LOC) → Console → Remote Play section,
~250 LOC (simpler layout).

---

## 16. Console — Backup & Restore

**Closes C8.** Enhanced Backup with smart suggestions.

### 16.1 Layout

```
┌─ Backup & Restore ──────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ Smart suggestions ────────────────────────────────────────────┐ │
│  │  💾 23 games with unbacked-up saves (last backup: never)        │ │
│  │     [Back up all saves →]                                       │ │
│  │  📅 Last full snapshot: 3 days ago                              │ │
│  │     [Create snapshot →]                                         │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Create snapshot ──────────────────────────────────────────────┐ │
│  │  Tag:      [pre-FW-upgrade      ]                               │ │
│  │  Scope:    (•) Full  ( ) Saves only  ( ) Trophies only          │ │
│  │            ( ) Selected games…  ( ) Settings only *(new)*       │ │
│  │  Path:     [~/PS5 Backups/      ] [Browse…]                     │ │
│  │  [Create snapshot]                                              │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Snapshots ────────────────────────────────────────────────────┐ │
│  │  Tag              Created       Size      Actions               │ │
│  │  ─────────────────────────────────────────────────────────────  │ │
│  │  pre-FW12         3 days ago    8.4 GB    [Restore] [Delete]    │ │
│  │  weekly           10 days ago   8.2 GB    [Restore] [Delete]    │ │
│  │  ...                                                           │ │
│  └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 16.2 Smart suggestions (closes C8)

The "Recommended" widget on Home (§5.5) surfaces the count of
unbacked-up games. Clicking it deep-links here with the scope
pre-filled to "saves-only" + the affected title_ids selected.

### 16.3 Backup as unified task

Per `v5-task-system.md §1.4`, backups create a `backup-snapshot` Task
that routes through the unified job system:

- Progress appears in Tasks → Active.
- Retry/recovery per Task System §2.3 (continue from next section).
- On completion, a notification fires + the Home "Recommended" widget
  updates.

### 16.4 Scheduled backups

Via Automation (Task System §12), users can set "Backup nightly at
03:00" — this creates an Automation that fires the `nightly-backup`
pipeline template. Configured from Settings → Automation or from
Console → Backup → "Schedule…".

### 16.5 What it replaces

`Backup/index.tsx` (346 LOC) → Console → Backup section, ~300 LOC +
the smart suggestions logic (shared with Home's Recommended widget).

---

## 17. Console — Shell

**Closes C4.** Relocates the Shell screen as a Console section.

### 17.1 Layout

```
┌─ Shell ─────────────────────────────────────────────────────────────┐
│                                                                     │
│  PS5 Pro:~$ _                                                       │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ $ ls /data                                                     │ │
│  │ saves  pkg  themes  ...                                        │ │
│  │ $ _                                                             │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  [>__________]   [↑ history]  [Clear]                              │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses `shellRun(addr, cmd)` (existing).
- Session-per-host (existing — clears on host change).
- Command history (cursor up/down).
- Command sequencing via `splitShellSequence` (existing — `;`, `&&`,
  `||` with quote/escape awareness).
- ⌘K shortcut can also open the shell as a quick command: type a
  shell command, hit Enter. This is the "⌘K → action" pattern from
  v5-design §4-G.

### 17.2 What it replaces

`Shell/index.tsx` (311 LOC) → Console → Shell section, ~280 LOC.

---

## 18. Console — Alerts

**Closes C9.** New section that surfaces the alert system from Task
System §7.

### 18.1 Layout

```
┌─ Alerts ────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ Active alerts (1) ────────────────────────────────────────────┐ │
│  │  🔥 CPU overheat — PS5 Pro — 87°C for 12s (threshold 85°C)     │ │
│  │     Fired 14:18.  Actions taken: uploads paused.                │ │
│  │     [Resolve (auto when CPU < 85°C for 60s)]  [Resume tasks]   │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Alert rules ──────────────────────────────────────────────────┐ │
│  │  ● CPU overheat      temps.cpu > 85°C for 10s   critical  [⚙]  │ │
│  │  ● SoC overheat      temps.soc > 85°C for 10s   critical  [⚙]  │ │
│  │  ● Fan maxed         fan.duty >= 100% for 30s   warn      [⚙]  │ │
│  │  ● Storage low       storage.free < 20 GB       warn      [⚙]  │ │
│  │  ● Storage critical  storage.free < 5 GB        critical  [⚙]  │ │
│  │  [+ New rule]                                                   │ │
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Alert history (last 7 days) ─────────────────  [View all →]──┐ │
│  │  🔥 14:18  CPU overheat (resolved 14:19, 1m duration)          │ │
│  │  ⚠  09:42  Fan maxed (resolved 09:43)                          │ │
│  │  ...                                                           │ │
│  └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 18.2 Rule editor

Clicking ⚙ on a rule (or "+ New rule") opens a modal:

```
┌─ Edit alert rule ───────────────────────────────────────────────────┐
│                                                                     │
│  Metric:    [temps.cpu ▾]      (any telemetry path)                 │
│  Condition: [> ▾]  [85]        (>, <, >=, <=, ==)                   │
│  Sustained for: [10] seconds   (debounce)                           │
│  Cooldown:  [60] seconds       (re-arm delay)                       │
│  Severity:  (•) Critical  ( ) Warn  ( ) Info                        │
│                                                                     │
│  Actions:                                                           │
│    [✓] Notify                                                       │
│    [✓] Pause tasks on this console                                  │
│    [ ] Play sound  [chime ▾]                                        │
│    [ ] Run task  [backup-snapshot ▾]                                │
│                                                                     │
│  Console scope:  (•) This console  ( ) All consoles                 │
│                                                                     │
│              [Delete]    [Cancel]    [Save]                         │
└─────────────────────────────────────────────────────────────────────┘
```

- Rules are the `AlertRule` type from `v5-task-system.md §7.2`.
- Defaults from §7.3 ship out of the box.
- "View all" → Tasks → Telemetry → Alerts log (historical).

### 18.3 Where alerts show up (recap)

> **R22/R29 (loops 81-90):** The canonical 5-surface list lives in
> `v5-cross-cutting-concerns.md` §6.7. The enumeration below is aligned to
> that list (it was previously attributed to Task System §7.4 and used a
> different ordering). Cross-cutting §6.7 is the source of truth.

Per cross-cutting §6.7, alerts surface in 5 places:
1. **Inline Callout** in the relevant screen (Console → Thermal for thermal, Tasks row for task, Game Hub for game-specific)
2. **Status bar chip** — global header, click to jump to #1
3. **Sticky Console banner** — top of Console tab, dismissible per-session *(this section)*
4. **OS notification** — desktop notification / Android channel (mobile §13.3)
5. **Critical toast** — the `tone="critical"` carve-out (a11y §19.17); sticky

This section (Console → Alerts) is the **management surface** (rules editor + history); the other 4 are display surfaces.

---

## 19. Mobile-Specific Design

### 19.1 Thermal Dashboard on mobile

- The fan curve editor uses **touch drag handles** — each point
  expands to a 44px circle on touch-start, so it's grabbable with a
  finger.
- Live readings stack vertically (temp, fan, power) instead of
  horizontally.
- The graph is swipeable horizontally to see more history.

### 19.2 Section navigation

- The left rail becomes a **horizontal swipeable strip** of icons at
  the top.
- Swipe left/right between sections.
- The active section's icon is underlined.

### 19.3 Shell on mobile

- A dedicated input bar above the keyboard with a "Run" button.
- Command history accessible via a ⌘ icon (not cursor up, which is
  desktop-only).
- Output is monospaced, scrollable, with copy-on-long-press.

### 19.4 Process table on mobile

- Columns collapse to: Name + Title ID, with a chevron to expand for
  PID/memory/threads/actions.
- "Kill" is in a kebab menu (not inline) to prevent accidental taps.
- System processes require an extra long-press (1.5s) to kill.

### 19.5 Profile avatar on mobile

- Image picker uses Scoped Storage picker (existing
  `LocalPathPicker`).
- Crop uses **pinch-to-zoom** instead of pixel-precise crop.
- Avatar preview is a large circle (touch-friendly).

### 19.6 Power control on mobile

- Each action (standby, restart, shutdown) is a large button with a
  long-press confirm (1.5s) instead of a dialog — faster for touch.
- "Wake via LAN" is a prominent button when the console is off.

---

## 20. Offline Behavior

### 20.1 Home tab offline

When the console is disconnected:
- **Connection card**: shows the disconnected state (§3.2).
- **At a glance**: shows "—" with last-known values dimmed.
- **Continue playing**: still shows the last-played game (from cache),
  but "Launch" is disabled with "PS5 offline" tooltip.
- **Quick actions**: all PS5-touching actions disabled; "Settings"
  still works.
- **Recent activity**: fully functional (reads from local Tasks store).
- **Recommended**: still computes from cached data; actions like
  "Backup all" become "Queue for when PS5 reconnects" (per Task System
  §10, tasks can be queued while disconnected).
- **Notifications**: fully functional (local store).

### 20.2 Console tab offline

- **All sections**: disabled with "PS5 offline" banners, EXCEPT:
- **Alerts**: rules are editable; history is browsable.
- **Notifications**: fully functional.
- **Profile**: cached user list visible; actions disabled.
- **Backup**: snapshots list from local store visible; create/restore
  disabled.

### 20.3 Reconnect

When the console reconnects (Task System §10.2):
- The Connection card flips to green.
- Any queued tasks (status `pending`, queueState `ready`) begin
  executing per the scheduler.
- A banner appears: "PS5 Pro back — 2 tasks ready to resume. [Resume
  all]".

---

## 21. Data Flows & State

### 21.1 Store map (existing + new)

| Store | Status | Role in Home/Console |
|-------|--------|----------------------|
| `useConnectionStore` | exists | Powers the Connection card |
| `useRosterStore` | exists | Console selector, active console |
| `useNotificationsStore` | exists | Home notifications widget + Console inbox |
| `useRunningAppsStore` | exists | Home "Continue playing", Console processes |
| `usePayloadPlaylistsStore` | exists | Payload Manager modal |
| `useBringUpStore` | exists | Cold-boot flow in send-payload modal |
| `useTelemetryStore` | **new** (Task System §8.2) | At a glance, Thermal Dashboard, Alerts |
| `useTasksStore` | **new** (Task System §1) | Home recent activity, queue status |
| `useAlertsStore` | **new** (Task System §7) | Console → Alerts section |
| `useHomeWidgetsStore` | **new** | Widget order, hidden widgets, dismissed suggestions |
| `usePowerControlStore` | **new** | Wraps power/control with task-awareness (pauses tasks before power off) |
| `useShellSessionStore` | **new** | Per-host shell session (extracted from Shell screen) |
| `useProcessStore` | **new** | Process list + modules, replaces inline state in Processes screen |

### 21.2 Telemetry fan-out

The telemetry SSE stream (`v5-task-system.md §8.1`) is the single data
source for:
- Home → At a glance
- Console → Thermal Dashboard (temps, fan, power)
- Console → Power & Battery (current draw)
- Console → Alerts (alert evaluator)
- Status bar (every screen)

One subscription, multiple consumers. No polling.

### 21.3 Widget refresh strategy

- **Connection card**: subscribes to `useConnectionStore` (already
  reactive). No poll.
- **At a glance**: subscribes to telemetry stream. No poll.
- **Recent activity**: subscribes to `useTasksStore` (reactive, fed by
  SSE). No poll.
- **Recommended**: re-computes on a 5-min timer + on Tasks store
  mutation. Lightweight.
- **Notifications**: subscribes to `useNotificationsStore` (reactive).

**Net: zero polls on Home in v5.** v4's Dashboard had a 5s poll; v5
eliminates it via the telemetry stream + reactive stores.

---

## 22. Migration & Screen Consolidation

### 22.1 Screens removed

| v4 screen | LOC | v5 location |
|-----------|-----|-------------|
| `Dashboard` | 358 | Home tab (widgets) |
| `Connection` | 1477 + PowerControl 241 + BringUpPanel 132 = 1850 | Home → Connection card + send-payload modal |
| `Payloads` | 63 + CatalogPanel 814 + SendPanel 742 + PlaylistsPanel 1219 + UsbAutoloaderModal 406 = 3244 | Home → Payload Manager modal |
| `Hardware` | 1425 + PowerTelemetryPanel 139 + PeripheralPanel 149 + SpeedTestPanel 134 + NetworkPanel 120 = 1967 | Console → Thermal + Power + Network + System Info |
| `Processes` | 569 | Console → Processes |
| `FanCurve` | 248 | Console → Thermal (fan curve editor) |
| `RemotePlay` | 336 | Console → Remote Play |
| `Notifications` | 184 | Console → Notifications |
| `Profile` | 824 | Console → Profile & Users |
| `FtpServer` | 201 | Console → Network → FTP |
| `NanoDns` | 224 | Console → Network → nanoDNS |
| `Shell` | 311 | Console → Shell |
| `FwSpoof` | 173 | Console → Firmware & System → Spoof |
| `Backup` | 346 | Console → Backup & Restore |

**Total: ~10,015 LOC of v4 screens → Home + Console tabs.**

### 22.2 Route redirects

```
/              → /  (Home — unchanged)
/connection    → /  (Home — Connection card)
/payloads      → /  (Home — with Payload Manager modal open)
/dashboard     → /  (Home)

/hardware      → /console?section=thermal
/processes     → /console?section=processes
/fan-curve     → /console?section=thermal
/remote-play   → /console?section=remoteplay
/notifications → /console?section=notifications
/profile       → /console?section=profile
/ftp           → /console?section=network
/nano-dns      → /console?section=network
/shell         → /console?section=shell
/fw-spoof      → /console?section=firmware
/backup        → /console?section=backup
```

Section is a URL param so deep links work and the back button is
sensible.

### 22.3 Settings preserved

- Roster, connection host, notification preferences — all preserved.
- No localStorage key changes for this redesign.

---

## 23. Cross-References to Other Tabs

### 23.1 Home → Games

- "Continue playing" → Game Hub for that title_id
- "Recommended: game updates" → Games grid (filtered)
- Quick action "Install PKG" → Games grid (or Files, depending on source)

### 23.2 Home → Files

- Quick action "Upload" → Files tab (upload mode)
- Quick action "FTP on/off" → toggles FTP (Console → Network), but
  "Browse via FTP" → Files → FTP location

### 23.3 Home → Console

- At a glance temp → Console → Thermal
- At a glance storage → Console → System Info
- At a glance running app → Console → Processes (or Game Hub)
- Recommended "Fan curve not set" → Console → Thermal
- Recommended "Storage low" → Console → System Info (or Files →
  disk-usage)

### 23.4 Home → Tasks

- Recent activity "View all" → Tasks tab
- Recommended actions create tasks (backup-all, etc.)

### 23.5 Console → Games

- Processes → "Open Game Hub" for a running title_id
- Profile → avatar applies to user (no Game Hub link)

### 23.6 Console → Files

- Network → FTP → "Browse via FTP" → Files → FTP location
- System Info → syslog "Download full log" → local file (via Files
  download path)

### 23.7 Console → Tasks

- Backup → creates `backup-snapshot` task → Tasks tab
- Alerts → alert-fired tasks appear in Tasks
- Power control → pauses running tasks before power off

---

## 24. Phased Implementation

> **Note (R5, loops 81-90):** Phase IDs `5.1-g..k` here are unique (the Game
> Hub uses `5.1-a..f`, File Browser uses `5.1-l.*`) and align with the
> canonical plan in `v5-cross-cutting-concerns.md` §12. The "Phase 5.2 — Alert
> integration" below was renamed to **5.2-a** (canonical alert-integration
> slot) — it was previously unlabeled and collided implicitly. Cross-cutting
> §12 is the source of truth.

### Phase 5.1-g — Console shell + Thermal (1.5 weeks)

1. Build Console tab shell with 12 sections (left rail / mobile strip)
2. Thermal Dashboard: live readings + fan curve editor
3. Migrate Hardware thermal portion + FanCurve
4. Wire to telemetry SSE stream

**Deliverable:** Console tab replaces Hardware + FanCurve.

### Phase 5.1-h — Console: Power, Processes, Network (1 week)

5. Power & Battery section (from PowerTelemetryPanel)
6. Processes section (from Processes screen) + module viewer (O4)
7. Network Services: FTP + nanoDNS + Speed Test + Interfaces (O3)
8. Firmware & System Info (FwSpoof + System summary + Peripherals)

**Deliverable:** Console tab now replaces 8 v4 screens.

### Phase 5.1-i — Console: Profile, RemotePlay, Shell, Backup (1 week)

9. Profile & Users section (from Profile screen)
10. Remote Play section (from RemotePlay screen)
11. Shell section (from Shell screen)
12. Backup & Restore section (from Backup screen) + smart suggestions

**Deliverable:** Console tab fully replaces all 11 v4 system screens.

### Phase 5.1-j — Console: Notifications, Alerts, Tools (0.5 weeks)

13. Notifications inbox (enhanced from Notifications screen)
14. Alerts section (new — rules + history, depends on Task System §7)
15. Tools sub-section: UFS fsck (O5) + app.db query (O6)

**Deliverable:** All orphaned APIs have a UI home. Console tab complete.

### Phase 5.1-k — Home tab (1 week)

16. Home shell with widget system
17. Connection card (status + send-payload modal + power menu)
18. Payload Manager modal (catalog + send + playlists + USB autoloader)
19. Dashboard widgets: At a glance, Quick actions, Continue playing,
    Recent activity, Recommended, Notifications
20. First-run wizard integration
21. Landing logic (Tasks active → Tasks tab; else Home)

**Deliverable:** Home tab replaces Dashboard + Connection + Payloads.

### Phase 5.2-a — Alert integration (0.5 weeks, depends on Task System §7)

22. Alert banner on Console (sticky, appears when alert active)
23. Alert rules editor
24. Alert history (from AlertLog)
25. Thermal Dashboard alert overlays on graphs

**Deliverable:** Full alert system live across Home + Console + Tasks.

**Total: ~5.5 weeks for complete Home + Console tabs**, closing all
12 Console gaps, 6 Home gaps, and 6 orphaned-API gaps, while reusing
the telemetry stream, unified Task store, and alert system from the
Task System redesign.

---

## Appendix A — Cross-reference: gap → section

| # | Gap | Closed in |
|---|-----|-----------|
| H1 | Dashboard read-only | §5 (live, actionable widgets) |
| H2 | Connection is its own screen | §3 (Home card) |
| H3 | No quick-launch from Home | §5.3 |
| H4 | No smart suggestions | §5.5 |
| H5 | No activity jump-links | §5.4 |
| H6 | Payloads buried | §4 (Payload Manager modal) |
| C1 | Fan/temps/power scattered | §8 (Thermal Dashboard) |
| C2 | Power telemetry buried | §9 |
| C3 | Processes lack detail | §10 (modules, memory, threads) |
| C4 | FTP/nanoDNS/Shell/RemotePlay scattered | §11, §15, §17 |
| C5 | FwSpoof read-only | §12 (action added) |
| C6 | Notifications flat | §13 (filterable, actionable) |
| C7 | Profile too heavy | §14 (Console section) |
| C8 | No backup suggestions | §16 |
| C9 | No alerts on Console | §18 |
| C10 | No system info summary | §12 |
| C11 | nanoDNS reload warning buried | §11.2 (inline) |
| C12 | Speed test/interfaces undiscoverable | §11.3, §11.4 |
| O1 | syslog/tail no UI | §12.3 |
| O2 | time/state no UI | §12.2 |
| O3 | netInterfacesGet no UI | §11.4 |
| O4 | procModulesGet no UI | §10.2 |
| O5 | ufsFsck no UI | §11.5 |
| O6 | appdbQuery no UI | §11.5 |
| R1 | Hardware+Processes+FanCurve → Console | §7–§10 |
| R2 | FTP+nanoDNS → Network Services | §11 |
| R3 | Backup stays Console-level | §16 |

## Appendix B — What does NOT move into Home/Console

- **Cheats / Saves / SDK / Activity / TMDB** → Game Hub (game context)
- **Upload / File browser / Search / Disk Usage / SMB** → Files tab
- **Transfer log / Stats / install status** → Tasks tab
- **Settings** → global settings drawer (not a Console section)
- **Logs / Audit Log / Bug Report** → Tasks → History (or Drawer)

The Console tab's job is **system-level control and monitoring**, not
per-game or per-file operations. Tools (§11.5, §12.3) is the escape
hatch for system-level power tools, kept deliberately small.

## Appendix C — Poll elimination

v4 Console-equivalent polls eliminated by the telemetry stream:

| v4 poll | Cadence | v5 source |
|---------|---------|-----------|
| Dashboard `fetchHwTemps` | 5s | telemetry stream `temps` |
| Dashboard `fetchHwPower` | 5s | telemetry stream `power` |
| Hardware `fetchHwTemps` | 5s | telemetry stream `temps` |
| Hardware `fetchHwPower` | 5s | telemetry stream `power` |
| Hardware `fetchHwStorage` | 5s | telemetry stream `storage` |
| Hardware `fetchDriveSensors` | 5s | telemetry stream `drive_sensors` |
| Hardware `smpMetaStats` | 5s | telemetry stream `smp` |
| Notifications `notifList` | 5s | incremental via `sinceSeq` (unchanged) |

**Net: 7 concurrent polls → 1 SSE subscription.** Plus the telemetry
ring buffer gives us historical graphs (Task System §8) that v4 never
had.

---

*This document revises `v5-design.md` §3.1 (Home), §3.4 (Console
screen mapping), §4-A/C/D (cross-feature integrations involving Home
and Console), §7 (Telemetry — now sourced from Task System §8), and
Appendix B rows for Dashboard, Connection, Payloads, Hardware,
Processes, FanCurve, RemotePlay, Notifications, Profile, FtpServer,
NanoDns, Shell, FwSpoof, and Backup. Other sections of v5-design
remain authoritative.*
