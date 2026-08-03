# ps5upload v5.0 — Cross-Cutting Concerns (Revised Design)

> **Scope.** This document resolves conflicts between the four revised
> design docs (`game-hub-revised-design.md`, `v5-file-browser-
> redesign.md`, `v5-task-system.md`, `v5-home-console-redesign.md`) and
> specifies the concerns that span every tab: navigation, routing,
> offline mode, error handling, edge cases, state ownership, and the
> drawer/shell. It is the plan of record for cross-cutting behavior.
>
> **Status:** PLANNING — no code written yet.
>
> **References:** all four revised docs + `v5-design.md` (parent).

---

## Table of Contents

0. [Conflict Register (cross-doc findings)](#0-conflict-register-cross-doc-findings)
1. [Navigation Revision — 5-Tab Layout Spec](#1-navigation-revision--5-tab-layout-spec)
2. [Route Structure & URL Grammar](#2-route-structure--url-grammar)
3. [Drawer & Shell Design](#3-drawer--shell-design)
4. [Deep-Linking & Cross-Tab Navigation](#4-deep-linking--cross-tab-navigation)
5. [Offline & Disconnected Mode](#5-offline--disconnected-mode)
6. [Unified Error Handling](#6-unified-error-handling)
7. [Edge Cases](#7-edge-cases)
8. [State Ownership & Boundary Map](#8-state-ownership--boundary-map)
9. [Permission & Capability Model](#9-permission--capability-model)
10. [Concurrency, Race Conditions & Conflict Resolution](#10-concurrency-race-conditions--conflict-resolution)
11. [Console Switching & Multi-Console Semantics](#11-console-switching--multi-console-semantics)
12. [Phased Implementation](#12-phased-implementation)
13. [Appendix A — Conflict Register (resolved)](#appendix-a--conflict-register-resolved)
14. [Appendix B — URL grammar cheat-sheet](#appendix-b--url-grammar-cheat-sheet)

---

## 0. Conflict Register (cross-doc findings)

The four revised docs were written in parallel loops (31–50). A
line-level cross-validation surfaced **18 conflicts** — 6 CRITICAL, 8
MAJOR, 4 MINOR — catalogued here with resolutions. The body of this
document specifies each resolution in detail.

| # | Severity | Area | Conflict | Resolution |
|---|----------|------|----------|------------|
| C1 | **CRITICAL** | Routes | `/ftp` redirects to `/console?section=network` (Home/Console §22.2) AND `/files?loc=ftp` (File Browser §1049) | §2.5 — split: `/ftp-server` (management, Console) vs `/files?loc=ftp` (browsing). `/ftp` → Console; "Browse via FTP" → Files |
| C2 | **CRITICAL** | Routes | Game Hub uses path params `/games/:title_id/:tab` (Game Hub §1.3, §4.1); Console uses query params `/console?section=` (Home/Console §22.2). Inconsistent grammar | §2.1 — adopt **hybrid**: tab/section is a query param everywhere (`?tab=`, `?section=`), path reserved for identity |
| C3 | **CRITICAL** | Task types | File Browser introduces job kinds `rename` (§1066) and `mirror` (§706, §1066); Task System's `TaskKind` union (§1.1 lines 62–73) does not list them | §8.3 + Task System addendum — extend `TaskKind` with `fs-rename` and `mirror`. Add to retry matrix §2.3 (both: restart, idempotent) |
| C4 | **CRITICAL** | Telemetry paths | Task System uses `storage.internal.free_gb` (§7.3 line 725); Home/Console uses `storage.free` (§18.1 line 1311). AlertRule.metric must be unambiguous | §6.2 + Task System §7.2 addendum — canonical = `storage.internal.free_gb`. Update Home/Console mockups |
| C5 | **CRITICAL** | Orphaned-API double-homing | `ufsFsck` (Home/Console §11.5 + File Browser §14.2), `appdbQuery` (Home/Console §11.5 + File Browser §14.3), `crc32File`+`fsBlake3Hash` (Home/Console §90 "moved to Files" + File Browser §10.2) — two docs claim the home | §9.2 — single home per orphan. UFS fsck + appdb → **Console → Tools** (system-layer). CRC/Blake3 → **Files** (file-layer). Cross-link, don't duplicate |
| C6 | **CRITICAL** | FTP toggle home | Home/Console §11.1 says FTP toggle lives "only" in Console; File Browser §3.3 has FTP as a *location* (browsing) with the toggle referenced from there. Conflicting claims of "the only place" | §9.3 — toggle lives in Console; Files FTP location has a "Manage FTP server" deep-link that opens Console → Network → FTP. Remove the "only" wording |
| C7 | **MAJOR** | Terminology | Game Hub "Media" tab includes "Screenshots + Videos" (§4.4); Home/Console Appendix B says "Screenshots/Videos → Game Hub → Media tab (or Files → filter)". Ambiguous fallback | §4.3 — Media tab is the primary home; Files is the secondary home via `?kind=screenshot\|video` filter, not a separate Media screen |
| C8 | **MAJOR** | State | Game Hub §6 references `appdb` enrichment; File Browser §14.5 also exposes "Query in app.db". Both reference `appdb` differently (read vs query-console) | §8.4 — appdb has two surfaces: (a) Game Hub reads silently for enrichment, (b) Console → Tools → app.db query is the power-user surface. Both legit, documented |
| C9 | **MAJOR** | Phases | Home/Console §24 names phases 5.1-g…5.1-k, 5.2; Task System §14 and File Browser §16 use different phase numbers; Game Hub §13 uses 5.1-a…5.1-f. No unified phase map | §12 — unified phase map. All docs should reference §12 of this document as the canonical sequencing. *(R28, loops 81-90: corrected — Task System §14 has NO phase plan, it defers to §12; File Browser §18 was renumbered to 5.1-l.1…5.1-l.6 + 5.2-f; Home/Console §24 keeps 5.1-g…k + 5.2-a; Mobile §17 renumbered to -mo suffixes. Game Hub §13 keeps 5.1-a…f.)* |
| C10 | **MAJOR** | Telemetry consumer gap | Game Hub "Play Time" (§4.6) reads historical play-time but no doc says whether it pulls from the telemetry stream or a separate API. Risk of re-introducing a poll | §5.4 — Play Time is a per-game aggregation from `gameActivityGet` (existing), NOT from telemetry stream. Telemetry stream carries only the live running-app id |
| C11 | **MAJOR** | Drawer contents | v5-design §3.3 lists Drawer = Payloads/Logs/AuditLog/BugReport/FAQ/About/Changelog; Home/Console moves Payloads to a modal (§4.3) and AuditLog to Tasks → History (App B). v5-design not updated | §3.1 — canonical drawer list. v5-design §3.3 is superseded |
| C12 | **MAJOR** | Command palette actions | v5-design §4-G lists ⌘K actions; Home/Console §17.1 says ⌘K can run shell commands; Task System §3.4 doesn't mention ⌘K at all. No unified ⌘K spec | §4.5 + Task System §3 addendum — unified ⌘K: navigate / act / run-shell / jump-task. Single spec |
| C13 | **MAJOR** | Alert surfaces count | Task System §7.4 says "alerts surface in 5 places"; Home/Console §18.3 says "5 places" with a different enumeration (includes Toast). Reconcile | **§6.7** *(R22: was "§5.5", corrected)* — canonical 5 surfaces: (1) inline Callout in relevant screen, (2) status bar chip, (3) sticky Console banner, (4) OS notification, (5) critical toast (the `tone="critical"` carve-out). Both docs align |
| C14 | **MINOR** | Drawer RTL | v5-design §3.3 says drawer "slides in from left (or right — configurable for RTL)"; no doc defines the RTL behavior precisely | §3.3 — LTR default left, RTL default right, user-overridable |
| C15 | **MINOR** | Haptics | v5-design §9.1 mentions haptic feedback on tab change; Home/Console §19.6 mentions long-press confirm on power. No unified haptic vocabulary | §6.5 — 3 haptic events: tap (light), confirm (medium), danger (heavy). Applied uniformly |
| C16 | **MINOR** | Status bar contents | v5-design §3.2 status bar shows version + temp + FPS; Home/Console §2 shows version + connection + task summary. Different fields | §1.4 — unified status bar: connection · temp · fan · power · running-app · active-task-count · alert-bell · version |
| C17 | **MINOR** | Empty-state copy | Home/Console §6.2/6.3 use specific copy; v5-design §8.1 says EmptyState is one component. Risk of divergent empty-state voices | §6.4 — EmptyState component takes `title`/`body`/`action` props; copy guidelines centralized |
| C18 | **MINOR** | Backup scope field | Home/Console §16.1 backup scope = Full/Saves/Trophies/Selected-games; Task System §2.3 references `backup-snapshot` retry "per-section (saves/trophies/settings)". "Settings" appears in Task System but not Home/Console UI | §7.6 — extend backup scope UI to include "Settings" as a 4th radio. Document the 4 sections |

---

## 1. Navigation Revision — 5-Tab Layout Spec

### 1.1 The 5 primary tabs (canonical)

| # | Tab | Route | Icon | Answers |
|---|-----|-------|------|---------|
| 1 | Home | `/` | `LayoutDashboard` | "What do I do right now?" |
| 2 | Games | `/games` | `Gamepad2` | "What's on my PS5, and what do I do with each game?" |
| 3 | Files | `/files` | `FolderTree` | "How do I move files around?" |
| 4 | Console | `/console` | `Cpu` | "How is my PS5 doing, and how do I configure it?" |
| 5 | Tasks | `/tasks` | `Activity` | "What's happening / what happened?" |

**Plus** a global Drawer (§3) for secondary surfaces, and a global
header (§1.3).

### 1.2 Desktop layout — left rail + content

```
┌────────────────────────────────────────────────────────────────────┐
│ [≡] ps5upload   [PS5 Pro ▾]              [⌘K]  [🔔 2]  [⚙]  [👤]   │ ← header (44px)
├──────┬─────────────────────────────────────────────────────────────┤
│      │                                                             │
│ 🏠   │                                                             │
│ 🎮   │                                                             │
│ 📁   │             Main content (router outlet)                   │
│ 🖥️   │                                                             │
│ 📋   │                                                             │
│      │                                                             │
│      │                                                             │
├──────┴─────────────────────────────────────────────────────────────┤
│ [● PS5 Pro] [62°C] [35% Fan] [85W] [● Astro's Playroom] [⏳ 2] [🔔] │ ← status bar (28px)
└────────────────────────────────────────────────────────────────────┘
```

- **Left rail:** 56 px wide, icon-only, vertically centered. Tooltip on
  hover shows label + keyboard shortcut (Alt+1..5). Collapsible to a
  0-width strip (hamburger in header re-opens); preference persists per
  device.
- **Header:** 44 px tall, glassmorphism (`backdrop-filter: blur(18px)`).
  Left: hamburger + app name. Center: console selector (roster picker).
  Right: ⌘K, notification bell (count badge), settings cog, profile
  avatar.
- **Status bar:** 28 px tall, always visible. See §1.4 for contents.
- **Touch targets (R27, loops 81-90):** All interactive elements meet **WCAG 2.5.5 AAA (44×44 CSS px)** as our project target — enforced at the component level (a11y §19). The WCAG 2.5.8 AA floor is 24×24; we treat that as the bare minimum for dense data-grid cells where 44px would harm usability, never as the default. See a11y §9 for the full touch-accessibility spec.

### 1.3 Header elements (global, tab-agnostic)

| Element | Behavior |
|---------|----------|
| Hamburger (≡) | Opens the Drawer (§3). Always present. |
| App name | Click → Home. |
| Console selector | Dropdown of roster. Switching triggers §11 semantics. Shows active console name + connection dot. |
| ⌘K | Opens command palette (§4.5). |
| 🔔 Notification bell | Count badge (unread + active alerts). Click → Console → Notifications. |
| ⚙ Settings | Opens Settings drawer (not a tab). |
| 👤 Avatar | Click → Console → Profile. |

**Contextual header actions** (tab-specific, right-aligned before the
global icons):
- Home: "Send payload" button (primary)
- Games: "Install PKG" button
- Files: "Upload" button
- Console: "FTP on/off" toggle
- Tasks: "Pause all" / "Resume all" (if any runnable)

### 1.4 Status bar (canonical — resolves C16)

The status bar is **one component** shown at the bottom of every screen
on desktop. On mobile, it collapses into the header (connection dot +
temp only; tap to expand). Contents, left to right:

```
[● PS5 Pro] [🌡 62°C] [ fan 35%] [⚡ 85W] [🎮 Astro's Playroom] [⏳ 2 tasks] [🔔 1]    v5.0.0
```

| Chip | Source | Click target | Offline behavior |
|------|--------|--------------|------------------|
| Console name + dot | `useRosterStore` + `useConnectionStore` | Console selector | `○ PS5 Pro` amber |
| Temp (max of CPU/SoC) | telemetry stream `temps` | Console → Thermal | `—` dimmed, last-known tooltip |
| Fan duty | telemetry stream `fan.duty` | Console → Thermal | `—` |
| Power draw | telemetry stream `power.draw` | Console → Power | `—` |
| Running app | telemetry stream `running_app` or `useRunningAppsStore` | Game Hub for that title_id | "PS5 idle" |
| Active task count | `useTasksStore` (status=running\|paused) | Tasks → Active | Count of queued/paused |
| Alert bell | `useAlertsStore` active count | Console → Alerts | Browsable history only |
| Version | build constant | — (or Drawer → About) | — |

Chips auto-hide when irrelevant (e.g., power chip hides if no telemetry;
alert bell hides if zero active + zero unread). Color rules per §5.5.

### 1.5 Mobile layout — bottom nav + top bar

Per v5-design §3.3 and §9.1. Bottom nav: 5 tabs, 56 px +
`env(safe-area-inset-bottom)`. Top bar: 44 px + safe-area top. Drawer
via hamburger. **No status bar on mobile** — its chips move into the
header (condensed: console dot + temp + alert bell).

### 1.6 Keyboard shortcuts (global)

| Shortcut | Action |
|----------|--------|
| Alt+1..5 | Switch to tab 1..5 |
| ⌘K / Ctrl+K | Command palette |
| ⌘, | Settings drawer |
| ⌘\ | Toggle left rail |
| Esc | Close topmost modal/drawer/palette |
| ⌘/ | Show keyboard shortcut cheat-sheet |

Tab-specific shortcuts are listed in each tab's design doc.

---

## 2. Route Structure & URL Grammar

### 2.1 URL grammar (resolves C2)

```
/<tab>                       tab root
/<tab>?<param>=<value>       tab with view/section/mode/filter
/<tab>/<entity-id>           entity detail (e.g. /games/:title_id)
/<tab>/<entity-id>?<param>   entity detail with sub-view
```

**Rule:** the path identifies *what*, the query string identifies *how
to view it*. Identity (console, game, file) is in the path. View
state (section, mode, filter, sort) is in the query string. This means:

- `/games/CUSA00506?tab=cheats` — correct (identity in path, view in query)
- `/games/CUSA00506/cheats` — wrong (tab is not identity)
- `/console?section=thermal` — correct (no entity identity; section is view)
- `/files?loc=ps5&path=/data&view=list` — correct

**Exception:** Tasks sub-views are query-only (`/tasks?view=active`),
no entity identity in path. A specific task is `/tasks?id=<task_id>`
(highlight-and-scroll) or reachable via its origin screen.

### 2.2 Tab → query-param vocabulary

| Tab | Param | Values | Notes |
|-----|-------|--------|-------|
| Home | — | — | No query params (widget state is internal) |
| Games | `tab` | overview, cheats, saves, media, addons, updates, storage, play-time | In Game Hub only |
| Games | `filter` | installed, library, updates, favorites, collection:<name> | Grid filter |
| Games | `sort` | name, last-played, play-time, size, installed-date | Grid sort |
| Files | `loc` | ps5, smb, ftp, recent, bookmark:<id> | Active location |
| Files | `path` | URL-encoded path within the location | |
| Files | `view` | list, grid, tree, disk-usage | View mode |
| Files | `mode` | browse, search, upload | Browser mode (search has its own `q=`) |
| Files | `q` | search query | When `mode=search` |
| Files | `select` | comma-separated file ids | Multi-select on open |
| Console | `section` | thermal, power, processes, network, firmware, notifications, profile, remoteplay, backup, shell, alerts, tools | Active section |
| Tasks | `view` | active, recent, history, statistics, telemetry | Sub-view |
| Tasks | `filter` | kind, outcome, console, date-range, pipeline | History filter |
| Tasks | `id` | task_id | Highlight a specific task |

### 2.3 Deep-link protocol

External deep-links use `ps5upload://`:

```
ps5upload://games/CUSA00506?tab=cheats
ps5upload://files?loc=ps5&path=/data/saves/CUSA00506
ps5upload://console?section=thermal
ps5upload://tasks?id=01HXY...
```

Tauri registers the scheme on install. Web/desktop share the path
grammar; only the scheme differs.

### 2.4 Old → new route redirects (canonical — supersedes all per-doc tables)

| Old route | New route | Notes |
|-----------|-----------|-------|
| `/` | `/` | Home (unchanged path, new content) |
| `/dashboard` | `/` | |
| `/connection` | `/` | Connection card + "Send payload" opens modal |
| `/payloads` | `/` | Payload Manager modal auto-opens via `?modal=payloads` |
| `/upload` | `/files?mode=upload` | |
| `/install` | `/games?modal=install` | |
| `/library` | `/games` | |
| `/installed` | `/games?filter=installed` | |
| `/file-system` | `/files` | |
| `/search` | `/files?mode=search` | |
| `/volumes` | `/files` | |
| `/disk-usage` | `/files?view=disk-usage` | |
| `/smb` | `/files?loc=smb` | |
| `/hardware` | `/console?section=thermal` | |
| `/processes` | `/console?section=processes` | |
| `/fan-curve` | `/console?section=thermal` | |
| `/remote-play` | `/console?section=remoteplay` | |
| `/notifications` | `/console?section=notifications` | |
| `/profile` | `/console?section=profile` | |
| `/nano-dns` | `/console?section=network` | |
| `/shell` | `/console?section=shell` | |
| `/fw-spoof` | `/console?section=firmware` | |
| `/backup` | `/console?section=backup` | |
| `/cheats` | `/games?filter=all` then pick game → `?tab=cheats` | No global cheats view |
| `/saves` | `/games` then pick game → `?tab=saves` | No global saves view |
| `/screenshots` | `/games` → `?tab=media&kind=screenshot` | |
| `/videos` | `/games` → `?tab=media&kind=video` | |
| `/game-activity` | `/games` → `?tab=play-time` | |
| `/sdk-changer` | `/games` → `?tab=storage` | SDK is under Storage tab |
| `/tmdb` | `/games?modal=tmdb` or auto on install | |
| `/activity` | `/tasks?view=recent` | |
| `/stats` | `/tasks?view=statistics` | |
| `/audit-log` | `/tasks?view=history&filter=audit` | |
| `/logs` | Drawer → Logs (still its own surface) | |
| `/bug-report` | `/tasks?view=history&action=bug-report` | Action, not destination |
| `/ftp-server` | `/console?section=network` | FTP *management* |
| `/ftp` | `/console?section=network` | Disambiguated: see §2.5 |
| `/faq` | Drawer → Help | |
| `/about` | Drawer → About | |
| `/settings` | (global settings drawer, no route) | Opened via ⚙ |
| `/changelog` | Drawer → What's New | |

### 2.5 The `/ftp` ambiguity (resolves C1, C6)

FTP has two distinct user intents that two docs each claimed as "the"
FTP home:

| Intent | Surface | Route |
|--------|---------|-------|
| **Manage** the FTP server (start/stop, port, credentials) | Console → Network → FTP | `/console?section=network` |
| **Browse** files over FTP | Files → FTP location | `/files?loc=ftp` |

- The bare `/ftp` redirects to **Console → Network** (the management
  surface — matches "FTP Server" the v4 screen name).
- Console → Network → FTP has a "Browse via FTP →" button that
  deep-links to `/files?loc=ftp`.
- Files → FTP location has a "Manage FTP server →" button that
  deep-links back to `/console?section=network`.
- The global ⌘K offers both: "Start FTP server" (action) and "Browse
  via FTP" (navigate).

**Documentation fix:** Home/Console §11.1 and File Browser §3.3 both
drop the "only" language; each references the other surface.

---

## 3. Drawer & Shell Design

### 3.1 Drawer contents (canonical — resolves C11)

The Drawer holds **secondary surfaces** — things that don't belong to a
game/file/system/task workflow and are accessed rarely. It is opened
by the hamburger (≡) in the header.

```
┌─ Drawer ───────────────────┐
│                            │
│  📦  Send payload          │  ← opens Home → send-payload modal
│  📚  Payload catalog       │  ← opens Home → Payload Manager modal
│  📜  Logs                  │  ← diagnostic logs (still its own view)
│  📋  Audit log             │  ← alias for /tasks?view=history&filter=audit
│  🐛  Bug report            │  ← opens /tasks?view=history&action=bug-report
│  ❓  Help / FAQ            │
│  💬  What's New            │  ← changelog
│  ℹ️  About                 │
│                            │
│  ─────────────────         │
│  ⚙   Settings             │  ← also reachable from header cog
│                            │
└────────────────────────────┘
```

- Drawer entries are **navigation shortcuts**, not separate routes
  where avoidable. "Audit log" is an alias for a Tasks sub-view.
- "Logs" remains a standalone surface (diagnostic, not task-related).
- Settings is also in the header cog; both open the same drawer panel.

### 3.2 Drawer mechanics

- Width: 320 px desktop / 85vw mobile (max 400 px).
- Slide-in animation: 220 ms ease-out (`anim-drawer` already exists).
- Scrim: tap to close. Esc closes.
- Remembers last-opened sub-section (e.g. Settings category).
- **LTR:** slides from left. **RTL:** slides from right. User can flip
  in Settings → Appearance (resolves C14).

### 3.3 RTL / flip behavior

- Default follows document direction (`dir="ltr"` / `dir="rtl"`).
- User override in Settings → Appearance → "Drawer side": Auto / Left /
  Right. Persisted in localStorage key `drawer.side`.

---

## 4. Deep-Linking & Cross-Tab Navigation

### 4.1 Cross-tab navigation matrix

Every "→" referenced across the 4 docs is catalogued here. Each is a
deep-link with a stable URL.

| From | Action | To (URL) |
|------|--------|----------|
| Home → Connection card | "Manage payloads" | `/` + open modal |
| Home → Continue playing | "Open Hub" | `/games/:title_id` |
| Home → At a glance | temp chip | `/console?section=thermal` |
| Home → At a glance | storage chip | `/console?section=firmware` or `/files?view=disk-usage` |
| Home → At a glance | running app | `/games/:title_id` |
| Home → Recent activity | row click | origin screen or Tasks row |
| Home → Recent activity | "View all" | `/tasks?view=recent` |
| Home → Recommended | "Backup all" | `/console?section=backup&scope=saves` |
| Home → Recommended | "Install" | `/games?filter=installable` |
| Home → Recommended | "Configure fan" | `/console?section=thermal` |
| Home → Notifications | "View all" | `/console?section=notifications` |
| Home → Quick actions | Upload | `/files?mode=upload` |
| Home → Quick actions | Install PKG | `/games?modal=install` |
| Home → Quick actions | Backup | `/console?section=backup` |
| Home → Quick actions | FTP on/off | `/console?section=network` (action) |
| Games → Grid tile | click | `/games/:title_id` |
| Games → Game Hub → Processes | "Open Game Hub" from process | `/games/:title_id` |
| Games → Game Hub → Media | "View in Files" | `/files?loc=ps5&path=/data/media/:title_id` |
| Files → FTP location | "Manage FTP server" | `/console?section=network` |
| Files → Selection → .pkg | "Install" | `/games?modal=install&src=<path>` |
| Files → Selection → .zip save | "Restore" | `/games/:title_id?tab=saves&action=restore&src=<path>` |
| Console → Network → FTP | "Browse via FTP" | `/files?loc=ftp` |
| Console → Processes | "Open Game Hub" | `/games/:title_id` |
| Console → Backup | smart suggestion | `/console?section=backup&scope=saves&titles=<ids>` |
| Console → Alerts | "View all" | `/tasks?view=telemetry&overlay=alerts` |
| Tasks → Active | row click | origin screen (e.g. install-done → Game Hub) |
| Tasks → Active | failed install → "Open Game Hub" | `/games/:title_id` |
| Tasks → Recent | backup-done → "Restore" | `/console?section=backup&action=restore&id=<id>` |
| Tasks → History | "Bug report" | modal (bundles last N entries) |

### 4.2 Deep-link preservation on console switch (resolves §11)

When a deep-link is followed AND the user switches console (§11), the
URL identity (game title_id, file path) is preserved but the *data*
refreshes from the new console. If the identity doesn't exist on the
new console (e.g. game not installed), show an inline empty state with
"Switch back to <previous>" button.

### 4.3 Modal-via-URL

Modals opened from a tab use a `?modal=<name>` query param so the link
is shareable and the back button closes the modal:

- `/games?modal=install`
- `/games/CUSA00506?modal=tmdb`
- `/` (Home) with `?modal=payloads` opens Payload Manager

### 4.4 File-selection deep-links

`/files?select=<id1>,<id2>` pre-selects files (used by Save Restore,
Checksum, etc. when jumping from Game Hub). Selection state lives in
`useFsSelectionStore`, seeded from the URL on mount.

### 4.5 Command palette (⌘K) — unified spec (resolves C12)

The command palette is a single modal offering 4 categories of results,
fuzzy-ranked:

| Category | Examples | Source |
|----------|----------|--------|
| **Navigate** | "Go to Games", "Go to Console → Thermal", "Open Astro's Playroom" | static + roster + library |
| **Act** | "Start FTP server", "Backup all saves", "Pause all tasks", "Set fan threshold 70°C" | action registry |
| **Run shell** | prefix `>` then a shell command, e.g. `> ls /data` | `shellRun` |
| **Jump to task** | prefix `#` then task id/name | `useTasksStore` |

- Mobile: full-screen modal (not 560 px fixed per v5-design §9.3).
- Recent commands appear first when query is empty.
- Shell-run and task-jump are hidden unless the prefix is typed (avoids
  clutter).

---

## 5. Offline & Disconnected Mode

### 5.1 Connection states

The connection has **5 states** (canonical; extends Task System §10):

| State | Meaning | UI signal |
|-------|---------|-----------|
| `connected` | Mgmt port + transfer port both reachable, payload responsive | green dot |
| `degraded` | Mgmt port up, transfer port slow/failing OR payload not elevated | amber dot |
| `disconnected` | Mgmt port unreachable (PS5 off, rest mode, network drop) | red dot, "Last seen Xm ago" |
| `reconnecting` | Auto-retry in progress | spinner |
| `never-connected` | Roster empty or console never contacted | wizard |

### 5.2 Disconnect detection

Per Task System §10.1, a **disconnect watcher** polls the mgmt port
every 5 s when `connected` and every 15 s when `disconnected`. The
watcher lives in `useConnectionStore` and emits state transitions.

On transition `connected → disconnected`:
1. All running tasks on that host flip to `paused` (reason: `host-down`).
2. The scheduler stops admitting new tasks for that host.
3. The telemetry stream closes; last snapshot is retained with a
   "stale" marker.
4. A global banner appears (§5.6).
5. Status bar chips flip to "—" with last-known tooltips.

### 5.3 Per-tab offline behavior

| Tab | Offline behavior |
|-----|------------------|
| **Home** | Connection card shows disconnected state (Home/Console §3.2). At-a-glance shows "—". Continue Playing disables Launch. Quick Actions: only Settings enabled. Recent Activity, Recommended, Notifications fully functional (local stores). Recommended actions become "Queue for reconnect". |
| **Games** | Grid shows cached library. Game Hub header degrades (Game Hub §12): status pill hidden, identity from cache. Cheats toggle disabled. Saves Backup/Restore disabled. Media browse disabled (PS5-side). Install PKG disabled. |
| **Files** | PS5 locations show "PS5 offline" banner. SMB/Local/FTP-local unaffected. Cross-location ops involving PS5 disabled. Clipboard items stay; paste into PS5 location queued. |
| **Console** | All sections show "PS5 offline" banner EXCEPT: Alerts (rules editable, history browsable), Notifications (local store), Profile (cached user list visible), Backup (local snapshot list visible, create/restore disabled). |
| **Tasks** | Fully functional. Running tasks for the disconnected host show as `paused`. Queued tasks show as `pending (host-down)`. History/Stats/Telemetry browsable. New tasks can be queued with `queueAfter: reconnect`. |

### 5.4 Reconnect

On transition `disconnected → connected`:
1. Telemetry stream re-opens.
2. Queued tasks (`queueState: ready`, host back) begin executing per
   the scheduler.
3. Paused tasks with reason `host-down` show a "Resume?" affordance; do
   NOT auto-resume (user may have wanted them paused).
4. Banner: "PS5 Pro back — N tasks ready to resume. [Resume all]
   [Review]".
5. Cache reconciles: library refresh, running-app refresh, etc.

### 5.5 Rest mode / reboot mid-task

Per Task System §10.4–10.5. Rest mode is detected as a brief disconnect
(typically < 60 s). Tasks with `rest-mode-recoverable = true` (uploads,
fs-copy/move, downloads) resume via `txIdHex`. Tasks without resume
semantics (cheat-download, tmdb-fetch — idempotent restart) re-run.

If the payload was lost (zombie threads, PS5 hard-reboot), a special
banner appears: "Payload lost — re-deploy to resume. [Re-send payload]"
and tasks stay `paused` until the payload is back.

### 5.6 Global banner

A single banner component at the top of the content area (below the
header, above the tab content). One banner at a time; priority order:

1. **Payload lost** (critical, blocks all PS5 actions)
2. **Console disconnected** (warn)
3. **Active alert: critical** (e.g. thermal)
4. **Tasks queued for reconnect** (info, dismissible)
5. **App update available** (info, dismissible)

The banner is NOT used for per-task errors (those are inline in Tasks)
or per-section alerts (those use the Console alert banner).

---

## 6. Unified Error Handling

### 6.1 Error categories

Every error falls into one of 5 categories, each with a defined UI
treatment:

| Category | Examples | UI treatment | Retry? |
|----------|----------|--------------|--------|
| **Transient** | Network blip, timeout, transfer-port EAGAIN | Inline "Retrying (2/3)…" on the task row; no modal | Auto (Task System §2.4) |
| **Recoverable** | Auth expired, payload not elevated, disk near-full | Inline "Action needed" with a fix button; no modal | After fix |
| **Fatal task** | DRM reject, file not found, archive corrupt | Task row red; "View error" expands details; "Retry" offered per Task System §4 | Manual (Task System §4.2) |
| **Fatal UI** | Required API 404, unhandled exception | ErrorBoundary full-screen with "Reload" / "Report bug" | Reload |
| **Validation** | Invalid IP, bad filename, over-long input | Inline field error (red text + icon) | After correction |

### 6.2 The `<ErrorBoundary>` (canonical)

Replaces the broken v4 ErrorBoundary. One component for the whole app,
with per-tab recovery:

```tsx
<ErrorBoundary
  tab="games"
  onError={(err, info) => bugReport.attach(err, info)}
  fallback={(reset) => <FatalError reset={reset} err={lastError} />}
>
```

- Uses `--color-surface-3` (not the broken `--color-surface-hover`).
- `--color-accent-contrast` for text (not hard-coded `text-white`).
- Shows: error name, message, stack trace (collapsible), "Reload tab"
  and "Report bug" buttons.
- "Report bug" pre-fills the Bug Report modal with the trace + last 10
  Tasks store entries + last 5 telemetry snapshots.

### 6.3 Inline error component

`<ErrorCard tone="error|warn|success|info">` — consolidates
ErrorCard/SuccessCard/WarningCard/InfoCard (v5-design §8.2). Used for
non-fatal per-section errors. Props: `title`, `body`, `action?`,
`onDismiss?`.

### 6.4 Empty states

`<EmptyState title body action hero?>` — v5-design §8.2. One component.
Copy guidelines (resolves C17):
- Title: imperative, 2-4 words ("No games yet", "Nothing here").
- Body: 1 sentence, explains why + how to fix.
- Action: the single primary CTA ("Install PKG", "Connect PS5").
- Hero: optional icon/illustration (40 px).

### 6.5 Toast notifications

For transient feedback (task started, settings saved, etc.). NOT for
errors (those are inline). One `<Toaster>` at the app root.

| Type | Use | Duration |
|------|-----|----------|
| success | Action completed | 3 s |
| info | Informational | 4 s |
| warn | Action needed soon | 6 s, requires dismiss |
| error | (use inline instead) | — |

Critical alerts (Task System §7.4) toast immediately, overriding the
"no errors in toast" rule.

### 6.6 Haptic vocabulary (resolves C15, R14)

Four haptic events, applied uniformly on mobile (canonical — `v5-mobile-design.md` §4.4 is the detailed reference):

| Event | Vibration pattern | When |
|-------|-------------------|------|
| `tap` | 10 ms light | Tab change, button tap |
| `selection` | 8 ms light | Toggle/Checkbox/Radio change, SegmentedControl switch |
| `confirm` | 20 ms medium | Destructive confirm, task start |
| `danger` | [20, 50, 40] ms heavy | Critical alert, power off confirm |

Uses `navigator.vibrate` (Android WebView). Silenced by a global
Setting → Accessibility → "Haptic feedback".

> **R14 resolution (loops 81-90):** The register originally said "three events" (tap/confirm/danger). `v5-mobile-design.md` §4.4 added a fourth, `selection`, for Toggle/Checkbox/Radio/SegmentedControl changes — which the 3-event set left undefined (those controls were either silent or mis-bucketed as `tap`). The 4-event set is canonical; this section updated to match.

### 6.7 Alert surfaces — canonical 5 (resolves C13 / R22)

A single alert (e.g. "PS5 temperature exceeded 85°C") must surface consistently across the app. These are the **5 canonical alert surfaces**, in priority order. An alert appears on **all that apply** for its severity (see Task System §7.4 for the severity→surface mapping):

| # | Surface | Where | Persistence | Component |
|---|---------|-------|-------------|-----------|
| 1 | **Inline Callout** in the relevant screen | Console → Thermal (for thermal alerts); Tasks tab row (for task alerts); Game Hub (for game-specific alerts) | Until dismissed or alert clears | `Callout tone="error"/"warn"` |
| 2 | **Status bar chip** | Global header (all screens) | While alert active; click → jump to #1 surface | Header chip with `bad`/`warn` dot |
| 3 | **Sticky Console banner** | Top of Console tab | While alert active | `Callout` variant, dismissible per-session |
| 4 | **OS notification** | Desktop notification / Android notification channel | OS-managed (doesn't auto-dismiss on Android; see mobile §13.3) | `Notification` API |
| 5 | **Critical toast** | Top of screen (mobile) / bottom-right (desktop) | Sticky until dismissed or alert clears (the `tone="critical"` carve-out, a11y §19.17) | `useToast({ tone: "critical" })` |

> **R22 note (loops 81-90):** The §0 C13 register cell originally pointed to "§5.5" for this list, but §5.5 is "Rest mode / reboot mid-task" — the list existed only in the register cell and in `v5-home-console-redesign.md` §18.3 (where it was attributed to Task System §7.4). This section is now the canonical home; Home/Console §18.3's citation is corrected to point here.

---

## 7. Edge Cases

### 7.1 Switching console while Game Hub is open

- URL identity (`/games/:title_id`) preserved.
- If the title_id exists on the new console → refresh all Game Hub
  data (cheats, saves, media, activity) from the new console.
- If not → inline empty state in the Game Hub body, header identity
  from cache, "Switch back to <previous>" button. The "Launch" button
  is disabled.
- The Game Hub's internal tab (e.g. `?tab=cheats`) is preserved.

### 7.2 Switching console while Files is open

- PS5 location → path is preserved IF the path exists on the new
  console's volume. If not, fall back to the volume root with a toast
  "Path not found on <new console>".
- SMB/Local/FTP-local locations are unaffected by console switch.
- Selection state is cleared on console switch (avoid cross-console
  paste mistakes).

### 7.3 Switching console while Tasks is open

- Tasks for the previous console remain visible (filtered by the
  console chip in Tasks header). Default filter = "this console" but
  user can switch to "all consoles" (Task System §13).
- Active tasks for the previous console continue running — console
  switch does NOT pause them.

### 7.4 Switching console mid-task

- The task is bound to its origin console, not the active console.
- Switching the roster does not affect running tasks.
- The Tasks tab always shows tasks for the selected console chip; to
  see the still-running task, the user switches the chip or uses "All".

### 7.5 Two browsers / two devices

- The engine accepts commands from any client. If two UIs are open,
  both see the same tasks via SSE.
- Conflict on the same file (both delete, both edit) → last-write-wins
  at the engine; the loser sees a "file vanished" error on retry.
- The roster is stored locally per device; two devices can have
  different rosters.

### 7.6 Backup scope (resolves C18)

The backup scope UI in Console → Backup gains a **4th radio**:
- (•) Full
- ( ) Saves only
- ( ) Trophies only
- ( ) Settings only *(new — was in Task System §2.3 but missing from
  Home/Console §16.1)*
- ( ) Selected games…

Task System §2.3 references sections: saves / trophies / settings.
Home/Console §16.1 lists Full / Saves / Trophies / Selected. The
canonical 4 sections are: **saves, trophies, settings, full**. "Full"
= all 3 + system settings dump. "Selected games" scopes saves to a
title_id subset.

### 7.7 Payload lost mid-op

The FTP thread persistence bug + zombie payload threads mean a PS5
reboot may be required. The app detects this via repeated mgmt-port
failures and shows the "Payload lost" banner (§5.6 priority 1). All
PS5-touching UI is disabled; only the "Re-send payload" button works.
The send-payload modal warns about the FTP-stop-before-redeploy rule.

### 7.8 Disk full mid-upload

- Task System §6 (scheduler) refuses to admit an upload if the
  storage-low alert is active.
- If the disk fills mid-upload, the engine returns ENOSPC; the task
  fails with a Fatal task error. The error row offers:
  - "Free up space" → `/files?view=disk-usage`
  - "Retry" (after space freed)

### 7.9 File locked / in use

- Engine returns EBUSY. Treated as transient (retry within budget).
- If still locked after N retries → Fatal task error, row offers
  "Kill process holding the file" (if a `processList` query identifies
  the holder).

### 7.10 Concurrent cheat-engine writes

Game Hub §7.5 specifies conflict detection between GoldHEN/etaHEN. The
conflict is resolved at the cheat-toggle layer (engine B disables
conflicting cheats on engine A). No cross-tab concern.

---

## 8. State Ownership & Boundary Map

### 8.1 Store ownership (canonical)

Each store has **one owner** (the tab/section that mutates it) and many
readers. This prevents write conflicts.

| Store | Owner (writes) | Readers |
|-------|----------------|---------|
| `useConnectionStore` | Home (Connection card) | All (status bar, banners) |
| `useRosterStore` | Header (console selector) | All |
| `useTasksStore` | Tasks tab | All (Home Recent Activity, status bar) |
| `useTelemetryStore` (ring buffer) | Telemetry SSE subscriber (app root) | Home, Console, Tasks, status bar |
| `useAlertsStore` | Alert evaluator (Task System §7) | Console → Alerts, status bar, Tasks → Telemetry |
| `useNotificationsStore` | Console → Notifications | Home widget, status bar |
| `useRunningAppsStore` | Telemetry stream | Home, Console → Processes, status bar |
| `useLibraryStore` | Games tab | Home (Continue playing), Tasks (install-done) |
| `useGameHubStore` (per title_id) | Game Hub | — |
| `useFsNavStore`, `useFsSelectionStore`, `useFsClipboardStore`, `useFsBulkOpStore` | Files tab | Game Hub (deep-links into Files) |
| `useMirrorJobsStore` | Files tab (mirror setup) | Tasks (mirror tasks appear in timeline) |
| `usePayloadPlaylistsStore` | Home (Payload Manager modal) | — |
| `useHomeWidgetsStore` | Home (widget customization) | — |
| `usePowerControlStore` | Console → Power | Home (Connection card power menu) |
| `useShellSessionStore` | Console → Shell | — |
| `useProcessStore` | Console → Processes | Game Hub (running app link) |
| `usePipelinesStore` | Tasks → Pipelines | — |
| `useAutomationsStore` | Tasks → Automations (or Settings) | — |
| `useSchedulesStore` (generalized) | Tasks → Automations | — |

### 8.2 SSE streams (canonical)

| Stream | Producer | Consumers |
|--------|----------|-----------|
| `/api/events` (existing) | Engine jobs map | Tasks, Files (bulk ops), Games (install) |
| `/api/ps5/telemetry/stream` (new) | Engine telemetry aggregator | Telemetry ring buffer → Home, Console, status bar, alert evaluator |
| `/api/ps5/syslog/tail` (existing) | Engine syslog | Console → System Info → syslog viewer |

One subscriber per stream at the app root; consumers read from the
reactive store, never subscribe directly.

### 8.3 TaskKind extension (resolves C3)

The File Browser's `rename` and `mirror` ops MUST be added to the Task
System's `TaskKind` union. Addendum to Task System §1.1:

```ts
type TaskKind =
  | "upload-file" | "upload-dir" | "upload-archive"
  | "download"
  | "fs-delete" | "fs-copy" | "fs-move"
  | "fs-rename"           // NEW — File Browser §9.3 (batch rename)
  | "pkg-install" | "pkg-dpi-install"
  | "backup-snapshot" | "backup-restore" | "save-backup" | "save-restore"
  | "cheat-download" | "tmdb-fetch" | "icon-fetch"
  | "mirror"              // NEW — File Browser §11.4
  | "pipeline"
  ;
```

Retry matrix addendum (Task System §2.3):

| Kind | Resume strategy | Manual restart offered? |
|------|-----------------|------------------------|
| `fs-rename` | Restart (atomic for < 50 items; rollback log for larger) | Yes |
| `mirror` | Continue (BLAKE3 change detection skips unchanged) | Yes |

### 8.4 Alert metric path canonicalization (resolves C4)

The telemetry snapshot has a canonical shape. AlertRule.metric paths
MUST match it exactly:

```ts
interface TelemetrySnapshot {
  temps: { cpu: number; soc: number; board: number };
  fan: { rpm: number; duty: number };
  power: { draw: number; voltage: number };
  storage: { internal: { free_gb: number; total_gb: number }; extended?: {...} };
  processes: { count: number; top: ProcessInfo[] };
  smp?: {...};
  running_app?: { title_id: string; name: string };
  drive_sensors?: {...};
}
```

- Canonical paths: `temps.cpu`, `temps.soc`, `fan.duty`, `fan.rpm`,
  `power.draw`, `storage.internal.free_gb`, `storage.internal.total_gb`.
- Home/Console §18.1 mockups must update `storage.free` →
  `storage.internal.free_gb`.
- The AlertRule editor's metric dropdown (Home/Console §18.2) is seeded
  from this shape (deep key paths).

---

## 9. Permission & Capability Model

### 9.1 Capability gates

Every PS5-touching action is gated on capabilities exposed by the
payload + connection state. The client checks capabilities before
showing UI (avoids "click → error" loops):

| Capability | Source | Affects |
|------------|--------|---------|
| `connected` | `useConnectionStore.status === 'connected'` | All PS5 actions |
| `elevated` | `useConnectionStore.ucredElevated` | Saves, Backup, Fan curve, FwSpoof, Profile |
| `payloadMinVersion(v)` | `useConnectionStore.payloadVersion` | Cheats (v ≥ X), Mirror (v ≥ Y) |
| `ftpRunning` | `ftpStatus(addr).running` | Files → FTP location browsing |
| `firmwareMin(v)` | `parsePS5Firmware(kernel)` | SDK Changer bounds, Install FW checks |

Disabled controls show a tooltip explaining the missing capability and
a "Fix" link where possible (e.g. "Re-send payload to elevate").

### 9.2 Orphaned-API single-homing (resolves C5)

| API | Single home | Cross-link from |
|-----|-------------|-----------------|
| `ufsFsck` | Console → Tools (system-layer) | File Browser → selection → "Verify volume" (deep-links to Console → Tools, pre-fills target volume) |
| `appdbQuery` | Console → Tools (system-layer) | Game Hub → Overview → "View in app.db" (deep-links to Console → Tools, pre-fills the title_id filter) |
| `crc32File`, `fsBlake3Hash` | Files (file-layer — selection toolbar) | Game Hub → Media → "Verify checksum" (deep-links to Files with the file pre-selected) |
| `syslog/tail` | Console → System Info → syslog viewer | — |
| `time/state/get\|set` | Console → System Info → Clock | — |
| `netInterfacesGet` | Console → Network → Interfaces | — |
| `procModulesGet` | Console → Processes → Modules sub-panel | — |

**Rule:** a system-layer concern (volume, database, system time, sys
log) lives in Console → Tools. A file-layer concern (checksum, hash)
lives in Files. Game Hub / Home deep-link but never duplicate.

### 9.3 FTP toggle home (resolves C6)

- **Toggle** lives in Console → Network → FTP.
- **Browse** lives in Files → FTP location.
- Home/Console §11.1 "this is the only place the FTP toggle lives" →
  rewritten to "the FTP *toggle* lives here; browsing lives in Files."
- File Browser §3.3 "the FTP location has a Manage link" → kept.

---

## 10. Concurrency, Race Conditions & Conflict Resolution

### 10.1 Two tabs racing the same file

The engine is the source of truth. If the user opens Files in two
browser tabs and deletes a file in tab A while selecting it in tab B,
tab B's selection is stale. On any FS op, the engine is authoritative;
the client re-reads the directory listing after each op and reconciles
selection (drop vanished entries, no error).

### 10.2 Task created while its origin screen is open

Tasks are reactive via the SSE stream. If the user kicks off an install
from ⌘K while on the Games grid, the Games grid sees the new task via
`useTasksStore` and updates the relevant tile (if the task's
`origin.screen === 'games'` and `origin.title_id` matches).

### 10.3 Alert fires while the user is editing the rule

The rule editor is a modal. If the rule fires while editing, the
evaluation uses the *saved* rule, not the in-progress edit. The user
sees the alert fire in the background (status bar bell). On save, the
new rule replaces; if the condition is still met, the alert continues;
if not, it resolves per the new rule's cooldown.

### 10.4 Roster delete while a task is running

If the user removes a console from the roster while a task is running
on it:
- The task continues (it's bound to the host, not the roster entry).
- The task becomes "orphaned" — visible only under "All consoles" in
  Tasks, with a warning icon.
- Confirmation dialog: "PS5 Pro has 2 running tasks. Remove anyway?
  [Cancel] [Remove — tasks continue]".

---

## 11. Console Switching & Multi-Console Semantics

### 11.1 The active console

One console is "active" at a time (`useRosterStore.activeProfileId`).
All tabs reflect the active console unless the tab has its own console
chip (Tasks does — see §11.3).

### 11.2 Switching

Switching the active console:
1. Emits a `roster:switch` event.
2. All stores keyed on `addr` reset/re-fetch for the new console.
3. URL identity is preserved (§4.2).
4. Tasks for the previous console remain running (§7.4).
5. The status bar reflects the new console.

### 11.3 Tasks tab — per-tab console chip

The Tasks tab has its own console filter chip defaulting to the active
console. Options: "This console" / "All consoles" / specific other
consoles. This allows monitoring tasks across consoles without
switching the global active console (Task System §13).

### 11.4 Cross-console operations

Cross-console copy (e.g. PS5 Pro → PS5 Fat) is supported via the Files
clipboard (File Browser §11.3). Each leg is a separate task; the
clipboard doesn't "broadcast" — it's copy-from-A then paste-to-B.

---

## 12. Phased Implementation

This unifies the phase numbers across all 4 revised docs (resolves
C9). All docs should reference this section as the canonical sequence.

### Phase 5.0 — Foundation (2-3 weeks)

Per v5-design §12. Shared primitives, design tokens, bug fixes. No
navigation change.

### Phase 5.1-a — Games tab shell + grid (0.5 weeks)

Games grid with filter/sort/favorites. Library merge (Library +
InstalledApps).

### Phase 5.1-b — Game Hub: Overview, Cheats (1 week)

Game Hub shell with URL-synced tabs. Overview tab. Cheats tab.

### Phase 5.1-c — Game Hub: Saves (1 week)

Saves tab with versioning.

### Phase 5.1-d — Game Hub: Media (0.5 weeks)

Screenshots + Videos merge into Media tab.

### Phase 5.1-e — Game Hub: Add-ons, Updates, Storage, Play Time (1 week)

Remaining 4 Game Hub tabs. SDK Changer folds into Storage. GameActivity
folds into Play Time.

### Phase 5.1-f — TMDB enrichment (0.5 weeks)

TMDB auto-fetch on install. Artwork action in Game Hub.

**Deliverable 5.1-games:** Games tab + Game Hub replace 6 v4 screens.

### Phase 5.1-g — Console shell + Thermal (1.5 weeks)

Console tab shell (12 sections). Thermal Dashboard. Hardware + FanCurve
migrate. Telemetry SSE wired.

### Phase 5.1-h — Console: Power, Processes, Network (1 week)

Power & Battery. Processes (+ modules). Network Services (FTP, nanoDNS,
Speed Test, Interfaces). Firmware & System Info.

### Phase 5.1-i — Console: Profile, RemotePlay, Shell, Backup (1 week)

Profile. Remote Play. Shell. Backup (+ smart suggestions).

### Phase 5.1-j — Console: Notifications, Alerts, Tools (0.5 weeks)

Notifications inbox. Alerts section. Tools (UFS fsck, app.db query).

### Phase 5.1-k — Home tab (1 week)

Home shell + widget system. Connection card. Payload Manager modal.
Dashboard widgets. First-run wizard.

### Phase 5.1-l — Files tab (2 weeks)

Unified File Browser shell. PS5 + SMB + FTP + Local locations. View
modes (list/grid/tree/disk-usage). Selection-aware toolbar. Clipboard
(cross-location). Batch rename. Checksum. Preview. Archive-out. Mirror
jobs.

### Phase 5.1-m — Tasks tab (1.5 weeks)

Tasks shell. Active/Recent/History sub-views. Unified Task envelope
(client side). Engine-side job routing (FS ops, PKG install, backup,
cheats). Statistics.

**Deliverable 5.1:** All 5 tabs in place. 40 v4 screens collapsed.

### Phase 5.2-a — Telemetry + Alerts (1 week)

Telemetry SSE endpoint (engine). Telemetry ring buffer (client).
Alert evaluator. Alert rules editor. Alert overlays on Thermal graphs.

### Phase 5.2-b — Pipelines (1 week)

Pipeline templates + instances. Visual editor. Per-game "Full setup".

### Phase 5.2-c — Automation (1 week)

Cron + event triggers. Automation store. Scheduled backups.

### Phase 5.2-d — Disconnected recovery (0.5 weeks)

Disconnect watcher. Rest-mode recovery. Reconnect banner. Queue-for-
reconnect.

### Phase 5.2-e — Multi-console (0.5 weeks)

Tasks console chip. Cross-console compare. Per-console Home layouts.

**Deliverable 5.2:** Telemetry, alerts, pipelines, automation,
multi-console all live.

### Phase 5.3 — Polish (1-2 weeks)

Spotlight panel on Games. Card hover lift. ⌘K actions. Mobile gestures
+ haptics. Accessibility audit. Onboarding update. Empty-state
consistency.

**Total: ~14-16 weeks for the complete v5 redesign.**

---

## Appendix A — Conflict Register (resolved)

See §0. All 18 conflicts are resolved above; the resolutions are
binding on the four revised docs. Each doc should be updated in the
final consolidation pass (loops 91-100) to reference this document for
the resolved concern.

## Appendix B — URL grammar cheat-sheet

```
/                                   Home
/games                              Games grid
/games/:title_id                    Game Hub (Overview tab default)
/games/:title_id?tab=cheats         Game Hub → Cheats
/games/:title_id?tab=saves          Game Hub → Saves
/games/:title_id?tab=media          Game Hub → Media
/games/:title_id?tab=addons         Game Hub → Add-ons
/games/:title_id?tab=updates        Game Hub → Updates
/games/:title_id?tab=storage        Game Hub → Storage (incl. SDK)
/games/:title_id?tab=play-time      Game Hub → Play Time
/games?modal=install                Install PKG modal
/games?modal=tmdb                   TMDB modal

/files                              Files (PS5 root, browse mode)
/files?loc=ps5&path=/data/saves     Files at a specific PS5 path
/files?loc=smb                      Files → SMB
/files?loc=ftp                      Files → FTP (browse)
/files?mode=search&q=foo            Files → search
/files?view=disk-usage              Files → disk-usage view
/files?mode=upload                  Files → upload mode
/files?select=id1,id2               Files with pre-selection

/console                            Console (Thermal section default)
/console?section=thermal            Console → Thermal
/console?section=power              Console → Power & Battery
/console?section=processes          Console → Processes
/console?section=network            Console → Network Services
/console?section=firmware           Console → Firmware & System
/console?section=notifications      Console → Notifications
/console?section=profile            Console → Profile & Users
/console?section=remoteplay         Console → Remote Play
/console?section=backup             Console → Backup & Restore
/console?section=shell              Console → Shell
/console?section=alerts             Console → Alerts
/console?section=tools              Console → Tools

/tasks                              Tasks (Active sub-view default)
/tasks?view=active                  Tasks → Active
/tasks?view=recent                  Tasks → Recent
/tasks?view=history                 Tasks → History
/tasks?view=statistics              Tasks → Statistics
/tasks?view=telemetry               Tasks → Telemetry
/tasks?view=history&filter=audit    Tasks → History (audit filter)
/tasks?id=<task_id>                 Tasks with a task highlighted
```

---

*This document is the plan of record for cross-cutting concerns. It
supersedes conflicting statements in `v5-design.md` §3.3 (drawer),
§3.2 (status bar), §4-G (⌘K), §9.1 (haptics), §12 (phases); and
resolves conflicts between the four revised docs. Each revised doc
remains authoritative for its own tab's detail; this document is
authoritative for everything that spans tabs.*
