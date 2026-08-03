# Game Hub — Revised Design (v5.1)

> **Purpose.** This is the per-game view inside the 5-tab redesign
> (Home, Games, Files, Console, Tasks). It replaces the v5.0 Game Hub
> sketch in `docs/v5-design.md §5`, which an audit found had 12
> CRITICAL/IMPORTANT gaps. This document closes every one of them.
>
> **Status:** DESIGN — supersedes the 6-tab layout
> (Overview/Cheats/Saves/Media/Patches/Activity) from v5.0.
>
> **References:** `docs/v5-design.md`, `docs/FEATURE-GAP-ANALYSIS.md`,
> engine: `saves.rs`, `pkg_install.rs`, `diagnostics.rs::crc32_file` /
> `fs_blake3_hash`, client: `state/pkgLibrary.ts`, `state/uploadQueue.ts`,
> `save_archive.rs`.

---

## 0. Gap-to-section index

Every audit item maps to a section below so nothing is dropped.

| # | Gap | Section |
|---|-----|---------|
| 1 | No Uninstall / Delete | §11, §3 header action |
| 2 | No DLC management | §9, tab `Add-ons` |
| 3 | No verify-install integrity | §10, tab `Storage` |
| 4 | Patches tab conflates SDK changer + game update | §3 (split: `Updates` vs `Storage→SDK`) |
| 5 | Cheats auto-apply has no rollback / safe launch | §7.3, §7.4 |
| 6 | No cheat profiles/presets | §7.2 |
| 7 | No cheat conflict detection | §7.5 |
| 8 | No clean-up after uninstall | §11.2 |
| 9 | Saves flat list, no versioning | §8.1, §8.2 |
| 10 | No save-to-USB restore verify | §8.4 |
| 11 | No batch ops from Games grid | §5.4 |
| 12 | Grid has no sort/filter/favorites/collections | §5.2, §5.3 |
| R1 | Library + InstalledApps merge → Games tab | §5.1 |
| R2 | `/api/ps5/library` aggregator | §5.1 data flow |
| R3 | Screenshots + Videos merge → Media tab | §4.4 |
| R4 | GameActivity → "Play Time" | §4.6 |
| R5 | TMDB auto on install | §6 step 2 |
| W1 | "Launch with cheats" visible next to status | §3 header |
| W2 | title_id as route param everywhere | §1.3 |

---

## 1. Entry Points

The Hub is reached from anywhere; **`title_id` is always carried as a
route param** (`/games/:title_id`) so deep links, the command palette,
and the running-game status bar all land on the exact same view.

### 1.1 Primary
- **Games grid** → click any tile → `/games/:title_id`
- **Command palette (⌘K)** → type a name or `CUSA…` →
  "Open Game Hub: *Astro's Playroom*". Fuzzy over name + title_id + alt
  names from TMDB.
- **Tasks tab** → a completed/failed install row → "Open Game Hub"
  action.

### 1.2 Contextual
- **Running-game chip in the status bar** ("▶ CUSA00506 running") →
  click → Hub for the foreground title. The chip already exists in the
  v5 telemetry stream (`running_app.title_id`).
- **Home tab "Continue playing"** card → click → Hub.
- **Notification inbox** → "Backup completed for *Astro*" → click →
  Hub `Saves` tab.
- **Task result toast** ("Installed *Elden Ring*") → "Open" → Hub.
- **Deep link / URL** — `ps5upload://games/CUSA00506` and
  `https://…/games/CUSA00506` for sharing across devices on the roster.

### 1.3 Identity contract
- Route is **always** `/games/:title_id` — never an index into a list,
  never a content_id. title_id is the only stable, user-visible key.
- PS5 title-ids are `[A-Z0-9]{4}\d{5}` (e.g. `CUSA00506`, `PPSA01234`,
  `NPXS39041`). The router validates this regex (mirrors the engine's
  `looks_like_title_id` in `lib.rs:2712`) and rejects anything else with
  a 404 — this is also the path-traversal guard used by the
  `/api/ps5/app-icon` handler (`lib.rs:2886`).
- All Hub data fetches funnel `title_id` into one
  `GET /api/ps5/library/:title_id` (see §5.1). Tabs subscribe to slices
  of that one response.

---

## 2. Header — always-visible

The header is sticky. Everything below it scrolls. It carries identity,
live status, and the 3–4 primary actions so a user never has to hunt.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [← Games]                                          [⋯ More]           │
│                                                                       │
│  ┌────────┐  Astro's Playroom                          ★  ⊕           │
│  │        │  CUSA00506 · PS5 · v1.02                                   │
│  │ Cover │  3.2 GB · SDK 9.00 · Installed 2025-03-15                  │
│  │  art   │  Played 42 h · Last 2 days ago  ● RUNNING                  │
│  └────────┘                                                           │
│                                                                       │
│  [▶ Launch]  [▶ Launch w/ cheats ▾]                                   │
│  [Cheats 12/15 ✓]  [Saves ✓ 3d]  [Verify ✓ 2d]   [🗑 Uninstall]      │
├──────────────────────────────────────────────────────────────────────┤
│ Overview │ Cheats │ Saves │ Media │ Add-ons │ Updates │ Play Time │ Storage│
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Header fields
| Field | Source | Notes |
|---|---|---|
| Cover art | `/api/ps5/app-icon?title_id=` → fallback TMDB → fallback letter-tile | Auto-fetched on install (§6). |
| Title | `library.name` (TMDB-enriched) | Falls back to title_id if missing. |
| title_id | route param | Always shown monospaced; click to copy. |
| Platform badge | `kind` (`ps5`/`ps4`) from appmeta | PS4 emu titles get a "PS4" pill. |
| Version | `param.json` `APP_VER` | e.g. `v1.02`. |
| Size | sum of `/user/app/<title_id>` (engine `title_dir_size`) | Live. |
| SDK | `param.json` `SDK_VER` | Drives the FW-required display. |
| Last played | `activity.json` (P0-2 tracker) | "never" if absent. |
| RUNNING pill | telemetry `running_app.title_id == this` | Pulses; click = Console tab. |

### 2.2 Header primary actions (gap #1, W1)
- **★ Favorite** — toggle (gap #12). Stored client-side in settings.
- **⊕ Add to collection** — opens collection picker (gap #12).
- **▶ Launch** — plain launch (FTX2 `AppLaunch`).
- **▶ Launch with cheats ▾** — split button (W1). Default = the active
  profile (§7.2); the dropdown lists profiles + **"Safe launch — no
  cheats"** + **"Last known good"** (§7.4). The current status badge
  ("Cheats 12/15 ✓") sits next to it so the user sees what will apply.
- **Status chips** (Cheats / Saves / Verify) — each is a deep link into
  the relevant tab, with a freshness indicator (✓ < 7 d, ⚠ older, ✗ never).
- **🗑 Uninstall** — gap #1; full flow in §11.
- **⋯ More** — overflow: *Re-fetch artwork, Open app folder, Copy
  title_id, Hide from grid, Report bad metadata*.

### 2.3 Offline behavior
When the PS5 is disconnected (§12) the header degrades gracefully:
launch/cheats/uninstall disabled with a tooltip "PS5 offline"; the
status chips show the **last cached** state with a dimmed clock icon;
Overview/Play Time/Media remain browsable from cache.

---

## 3. Revised Tab Structure

The v5.0 6-tab layout conflated two unrelated things under "Patches"
and buried integrity/DLC/uninstall entirely. The revised Hub has **8
tabs**, but only ~5 are ever visible for a given game — empty tabs are
hidden (e.g. a game with no DLC hides `Add-ons`).

| Tab | Visible when | Closes gap |
|---|---|---|
| **Overview** | always | — |
| **Cheats** | cheats exist or engine supports | #5,#6,#7 |
| **Saves** | always (PS4/PS5) | #9,#10 |
| **Media** | screenshots or clips exist | R3 |
| **Add-ons** | DLC exists or is installable | #2 |
| **Updates** | a game-update PKG is known | #4 |
| **Play Time** | always (R4 rename) | R4 |
| **Storage** | always | #3,#4 (SDK lives here) |

> **Why split Updates and Storage?** The audit (#4) is right: an SDK
> *changer* patch (forcing `param.sfo` to claim a lower SDK so a game
> boots on old FW) and a *game update* PKG (Sony's v1.05 → v1.12
> content) are completely different operations. Bundling them caused
> users to "patch" their game when they meant to "update" it. Now:
> - **Updates tab** = install/manage game-update PKGs (content category
>   `gp`, routed via the existing `pkgLibrary` ordering logic).
> - **Storage tab** = integrity verify + SDK changer + on-disk size
>   breakdown + uninstall/cleanup entry. Both are *storage-level*
>   operations on the installed bits.

Tabs are URL-synced (`/games/:title_id/:tab`) so deep-linking and the
back button work. On mobile they become a horizontally swipeable strip
(§9.3 of v5-design).

---

## 4. Each Tab in Detail

### 4.1 Overview
A scannable summary; every section is a jump-link into the relevant tab.

```
┌─ Installation ────────────────────────────  [Storage →] ─┐
│ Version 1.02 · 3.2 GB · SDK 9.00 · FW req 7.50           │
│ Integrity: ✓ verified 2 days ago (BLAKE3)  [Re-verify]   │
└──────────────────────────────────────────────────────────┘
┌─ Cheats ───────────────────────────────  12 active / 15 ─┐
│ Profile: "Easy Mode" ▾        Auto-apply on launch: ●ON  │
│ GoldHEN 8 · etaHEN 4          [Manage →]                 │
└──────────────────────────────────────────────────────────┘
┌─ Saves ─────────────────────  ✓ backed up 3 days ago ───┐
│ 3 slots · 2 versions each · last USB copy: never         │
│ [Backup now]  [Backup all →]                            │
└──────────────────────────────────────────────────────────┘
┌─ Add-ons ──────────────────────────  2 installed / 4 ───┐
│ DLC "Cosmetic Pack" ✓     DLC "Soundtrack" [Install]     │
└──────────────────────────────────────────────────────────┘
┌─ Media ─────────────────────────  14 shots · 3 clips ───┐
│ [thumbnail strip]                                        │
└──────────────────────────────────────────────────────────┘
┌─ Play Time ─────────────────────────  42 h · 15 sess. ──┐
│ This week: ▁▃▅▇▆▄▂   First played: 2025-01-04            │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Cheats — see §7 (deep design)
### 4.3 Saves — see §8 (deep design)
### 4.4 Media (closes R3 — merge screenshots + videos)
One tab, a **kind toggle** `[All] [Screenshots] [Video clips]`, a
unified grid, and bulk select. Removes the redundant v4 Screenshots +
Videos screens entirely.

- Grid of thumbnails (video clips show a ▶ overlay + duration).
- Multi-select → Download (zip), Delete, Copy to USB.
- Click → lightbox (images) / inline player (video; transcodes via the
  existing `screenshots/convert` path).
- Filter by date, by user (if multiple accounts).
- "Open in Files" → jumps to Files tab pre-filtered to this game's
  capture folder.

Edge cases: zero media → friendly empty state with "Captures you take
on the PS5 will appear here." Media listing fails (payload error) →
retry card, not a silent blank.

### 4.5 Add-ons — see §9 (deep design)
### 4.6 Updates
Lists known game-update PKGs for this title (from `pkgLibrary`, content
category `gp`) with install state, and surfaces the live installed
version. This is **only** about content updates — not the SDK changer
(#4).

```
Current installed version: 1.02   [Check for newer PKG in library]

Available updates (in your PKG library)
┌──────────────────────────────────────────────────────────┐
│ Update v1.05   420 MB   2025-05-01   [Install]   ⓘ      │
│ Update v1.12   680 MB   2025-07-18   [Install]   ⓘ      │
└──────────────────────────────────────────────────────────┘
```

- Only one update can install at a time; the engine already orders
  base→update→DLC (`pkgLibrary.ts:pkgEntryInstallOrder`). The Hub
  surfaces that: installing v1.12 queues behind v1.05 if both selected.
- The ⓘ explains "Game updates come from PKG files you provide; we do
  not fetch them from PSN."
- "Installed here" badge uses the per-content_id tracking introduced in
  v3.3.8 (`pkgLibrary.ts` around line 160) so a re-install shows
  "Reinstall" rather than a false "Installed".

### 4.7 Play Time (closes R4 — rename)
Renamed from "Activity" to avoid colliding with the Tasks timeline.
Two sources, merged client-side:
1. **Self-tracked** (`activity.json` from the P0-2 payload thread) —
   sessions: start, end, duration, cheat profile used.
2. **System DB** (`sl2_log.db` via `ActivityDbQuery`) — historical
   totals, recently-played.

Charts: total hours, sessions, last-30-days bar, "by cheat profile"
breakdown (ties back to §7.2 so you can see "Easy Mode: 38 h, No
cheats: 4 h"). Per-session list with launch-method (plain / w-cheats /
safe).

### 4.8 Storage (closes #3, #4)
On-disk reality of the install: size breakdown, integrity, SDK changer,
uninstall entry.

```
┌─ Disk usage ─────────────────────────────────────────────┐
│ /user/app/CUSA00506            3.21 GB                   │
│   app.pkg                      3.10 GB                   │
│   sce_sys/                      48 MB                    │
│ /user/appmeta/CUSA00506         1.2 MB                   │
└──────────────────────────────────────────────────────────┘
┌─ Integrity ──────────────────────────────────────────────┐
│ Last verified: 2 days ago (BLAKE3, all files match)      │
│ [▶ Verify now]   [Verify with CRC32 (faster)]            │
└──────────────────────────────────────────────────────────┘
┌─ SDK / Firmware ─────────────────────────────────────────┐
│ Current SDK: 0x09000000 (9.00)  FW required: 7.50        │
│ Your FW: 7.55 ✓ boots                                    │
│ [Change SDK version…]  (advanced)                        │
└──────────────────────────────────────────────────────────┘
┌─ Danger zone ────────────────────────────────────────────┐
│ [🗑 Uninstall…]   [🧹 Clean up orphaned data…]           │
└──────────────────────────────────────────────────────────┘
```

The SDK changer moved here from the old "Patches" tab (gap #4). It
keeps its pre-patch backup of `param.sfo` (already in `sdk_changer.c`)
and shows a "Revert SDK" action when a backup exists.

---

## 5. Games Grid (closes #11, #12, R1, R2)

### 5.1 The aggregator endpoint (closes R1, R2)
Today, Library and InstalledApps are two screens with ~90% overlap and
users can't tell which list they're looking at. v5.1 merges them into
**one Games tab** backed by one endpoint:

```
GET /api/ps5/library?addr=IP:MGMT_PORT
→ {
  "titles": [
    {
      "title_id": "CUSA00506",
      "name": "Astro's Playroom",
      "kind": "ps5",                 // from appmeta
      "icon_url": "/api/ps5/app-icon?title_id=CUSA00506",
      "version": "1.02",
      "sdk_version": "0x09000000",
      "fw_required": "7.50",
      "size_bytes": 3234567890,
      "installed_at": 1710500000,
      "last_played": 1722300000,     // from activity.json (may be null)
      "play_seconds": 151200,
      "category": "gd",              // gd=base, gp=update, ac=DLC
      "content_id": "UP9000-CUSA00506_00-…",
      "tmdb": { "publisher": "…", "genre": "Platformer", "release": "2020-11-12" },
      "cheats": { "active": 12, "total": 15, "profile": "Easy Mode", "conflict": false },
      "saves": { "count": 3, "last_backup": 1722000000 },
      "dlc_installed": 2, "dlc_available": 4,
      "update_available": true,      // a newer gp PKG is in the local library
      "favorite": true,              // client-side
      "collections": ["JRPG"],
      "source": ["installed","library"]   // merged provenance
    },
    …
  ]
}
```

The engine fuses 3 sources (already individually implemented; this just
joins them):
1. **Installed** — `/user/appmeta/*` walk + `param.json`/`param.sfo`
   (`lib.rs:2789`). Definitive for "does it boot."
2. **app.db** — `app_list` query for launchability + category.
3. **Local PKG library** — `pkgLibrary` scan for base/update/DLC PKGs
   the user staged but may not have installed yet. These appear as
   "Installable" tiles (dashed border) so the user can install without
   leaving the grid.

Cheats/saves/DLC counts are joined from their respective engines; if a
join fails the field is `null` (never blocks the list).

Per-title detail: `GET /api/ps5/library/:title_id` returns the same
shape, single object — this is what the Hub header subscribes to.

### 5.2 Sort & filter (closes #12)
Sticky toolbar above the grid:

```
[Sort: Recently played ▾]  [Filter]  [View: Grid ▦ / List ☰]  [⋮]
   Filter:  Platform ☐PS5 ☐PS4   State ☐Installed ☐Installable ☐Update avail.
            Cheats ☐Has cheats   Play Time ☐Never played   Collection ▾
```

Sort keys: Recently played (default), Name A–Z, Install date, Play time,
Size, Cheats active, Last backup. Choice persists per roster.

Filters are composable chips. A "Reset" appears when ≥1 active. A live
count "23 of 47" reflects the filtered set.

### 5.3 Favorites & collections (closes #12)
- **Favorite** ★ — one-tap on the tile (top-right star). Favorites pin
  to the top by default (a sort option "Favorites first" is on by
  default).
- **Collections** — user-defined tags ("JRPG", "Co-op night",
  "Beat"). A tile's ⊕ adds it; a left-rail "Collections" group lists
  them. Collections are client-side state (settings.json) keyed by
  title_id, so they survive reinstalls and roam across the roster.

### 5.4 Multi-select & batch ops (closes #11)
- Long-press / checkbox corner on a tile enters multi-select.
- A bottom action bar appears:
  ```
  3 selected — [Backup saves] [Install cheats] [Verify] [Uninstall] [Add to collection]
  ```
- Each action runs as a **unified job** (§6 of v5-design: routed through
  `jobs` + SSE) so it appears in Tasks with overall + per-item progress.
- **"Backup all" / "Uninstall all"** iterate the selection; failures
  are aggregated, not abort-on-first (mirrors `client/src/lib/bulkDelete.ts`).
- Safety: any destructive batch (Uninstall, Delete saves) requires
  typing the count to confirm.
- Edge cases handled: a title mid-install is greyed out and
  unselectable; a title currently running is selectable for backup but
  not for uninstall (tooltip explains).

### 5.5 View modes
- **Grid** — cover-art tiles, 2:3 aspect, hover shows title_id + status
  icons (cheats/saves/update). Default on desktop >900px and all mobile.
- **List** — dense rows: icon, name, title_id, version, size, play time,
  status chips. Power-user mode.
- **Compact** — list without icons (for very large libraries, 200+ titles).

---

## 6. Game Lifecycle (closes #8 indirectly, R5)

The Hub supports the full arc, not just the "installed" state.

```
   install → enrich → play → update → DLC → integrity → uninstall → cleanup
      │         │        │        │        │        │           │         │
   Tasks     TMDB auto  Launch  Updates  Add-ons  Storage     Storage   Storage
   tab       +icon      header  tab      tab      tab         §11       §11.2
```

1. **Install.** Initiated from Games → "Install PKG" (a base `gd` PKG).
   Runs through the existing `pkg_install` pipeline (base→update→DLC
   ordering already enforced in `pkgLibrary.ts`). Progress in Tasks.
   On completion, a toast offers "Open Game Hub" (entry point §1.2).
2. **Enrich (R5).** Immediately after install, the engine kicks off
   (background, no separate screen):
   - TMDB fetch (`tmdb_fetch`) → name, description, art, genre.
   - app-icon fetch → cover.
   - Cheat repo scan for this title_id → "12 cheats available" toast.
   This is the *auto on install* the audit asked for; the user never
   sees a "TMDB screen." If enrichment fails (offline), it retries on
   next connect and the Overview shows a "Re-fetch artwork" action.
3. **Play.** Launch from header; telemetry updates the RUNNING pill;
   Play Time records the session.
4. **Update.** A newer `gp` PKG in the library lights up the Updates
   tab badge and a header dot.
5. **DLC.** A known `ac` PKG shows in Add-ons with [Install].
6. **Integrity.** Optional verify after any disk hiccup (Storage tab).
7. **Uninstall + cleanup.** §11 — including orphan sweep (#8).

---

## 7. Cheat Management (closes #5, #6, #7)

### 7.1 Cheats tab — layout
```
┌─ Engine: [GoldHEN ▾] [etaHEN] [Shark]    [Refresh] [⬇ Download more] ─┐
│ ⚠ Conflict: GoldHEN + etaHEN both hook memory — pick one. [Resolve]   │
├─ Profile: [Easy Mode ▾] [+] [Manage profiles…]    Auto-apply: ●ON     │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ ☑ Infinite Health        GoldHEN      [ON]   last good ✓          │ │
│ │ ☑ Infinite Stamina       GoldHEN      [ON]                          │ │
│ │ ☐ One Hit Kill           etaHEN       [off]                         │ │
│ │ ☑ Super Jump             GoldHEN      [ON]                          │ │
│ │ …                                                                │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ [Save as profile…]  [Apply now]  [Safe launch without cheats]        │
└──────────────────────────────────────────────────────────────────────┘
```

- Filtered to **this title_id only** (FTX2 `CheatList` already takes
  `title_id`).
- The engine selector gates which list shows; enabling a cheat on
  engine B silently disables conflicting cheats on engine A (§7.5).
- "Download more" opens a repo browser scoped to this title_id
  (ps5cheats / GoldHEN / HENCollection — same repos as the FTX2
  `CheatRepoDownload` frame).

### 7.2 Profiles / presets (closes #6)
A **profile** is a named, named combination of enabled cheats for one
title_id:

```json
{
  "title_id": "CUSA00506",
  "name": "Easy Mode",
  "cheats": {"goldhen:inf_health": true, "goldhen:inf_stamina": true, "goldhen:super_jump": true},
  "engine": "goldhen",
  "auto_apply": true,
  "created": 1722000000,
  "last_good": 1722200000
}
```

- Per-game, stored client-side (`settings/cheat_profiles.json`) keyed by
  title_id, so they survive reinstalls and roam across the roster.
- The header split-button "▶ Launch w/ cheats ▾" lists profiles; the
  Overview "Profile: Easy Mode ▾" selects the active one.
- Built-in defaults: **"All off"** (≡ safe launch) and **"All on"**.
- "Save as profile…" creates one from the current checkbox state.
- Profiles are shareable: export/import JSON, and a community "popular
  for this game" list (curated, opt-in).

### 7.3 Auto-apply + rollback (closes #5)
"Auto-apply on launch" is a per-game toggle (persists in the profile).
The problem the audit raised: if a cheat crashes the game on launch,
there's no way back. Design:

- **Last known good (LKG).** Every successful launch with cheats stamps
  the applied set as `last_good` (timestamp + hash of the cheat file).
  The header "Launch w/ cheats ▾" shows **"Last known good"** which
  re-applies exactly that set, ignoring newer toggles.
- **Crash detection.** The telemetry stream reports the running title;
  if it disappears within 60 s of a cheat-enabled launch, the Hub flags
  the launch as "Crashed after cheats" and:
   1. Does **not** update `last_good`.
   2. Shows a prominent **inline `Callout tone="error"`** at the top of
      the Game Hub (not a toast — see R20 note below) with three action
      buttons: "Astro's Playroom crashed after launch. [Launch without
      cheats] [Try last known good] [Keep cheats]." The callout persists
      until dismissed or resolved.
   3. The next "Launch w/ cheats" default flips to LKG, not the current
      set, until the user resolves.

> **R20 note (loops 81-90):** The original spec called this a "toast,"
> but cross-cutting §6.5 bans errors from toasts and the canonical
> Toaster API (a11y §19.17) supports only one action button — this
> crash-recovery surface needs three and is semantically an error.
> Render it as a persistent inline `Callout tone="error"` with three
> action buttons instead. The only error-class toast permitted is the
> `tone="critical"` carve-out for Task System §7.4 thermal/power alerts.
- **Safe launch.** Always one tap: applies zero cheats for this launch
  only, without changing the profile. This is the rollback path.
- **Pre-launch snapshot of `param.sfo`/cheat files** is taken before
  any auto-apply so a "Revert to pre-cheats" is possible in Storage.

### 7.4 Safe-launch button placement (W1)
The header carries both `[▶ Launch]` and `[▶ Launch w/ cheats ▾]`
side by side, with the active profile name visible. This directly
solves "the user can't find how to launch without undoing their cheat
config." On mobile the two collapse into one `[▶ Launch ▾]` split
button with the same items.

### 7.5 Conflict detection (closes #7)
The audit: "GoldHEN + etaHEN simultaneously can crash." Engine rules
live in the payload (where the hook knowledge is), surfaced as a
manifest the client fetches:

```
GET /api/ps5/cheats/engines
→ {"engines":[
    {"id":"goldhen","name":"GoldHEN","conflicts":["etahen"]},
    {"id":"etahen","name":"etaHEN","conflicts":["goldhen","shark"]},
    {"id":"shark","name":"Shark","conflicts":["etahen"]}
  ]}
```

Behavior:
- If the user enables a cheat from an engine that conflicts with an
  already-enabled engine, a **blocking warning** appears:
  `"GoldHEN + etaHEN hook the same memory and crash the game. Disable
  etaHEN cheats first?" [Disable etaHEN] [Cancel]`.
- The header status chip shows ⚠ and "Launch w/ cheats" refuses to
  fire until resolved (or the user explicitly picks "Safe launch").
- Within a single engine, known *cheat-vs-cheat* conflicts (e.g. "One
  Hit Kill" + "Infinite Health" on some titles) are flagged with an
  inline ⚠ on the row and a tooltip; enabling one greys out the other
  with a "Conflicts with Infinite Health" note.

### 7.6 Edge cases
- No cheats available → empty state "No cheats found for this title.
  [Search repos] [Open cheat file…]".
- Cheat file parse error → row shows "⚠ malformed (skipped)" with a
  "Show details" that logs the file path; doesn't break the list.
- Game running while toggling → "Cheats apply at next launch" notice
  (live patching is engine-dependent; we don't promise hot-swap).
- title_id with no community cheats but user has a local file →
  "Import cheat file…" action.

---

## 8. Save Management (closes #9, #10)

### 8.1 Versioned save list (closes #9)
The v4/v5.0 Saves tab was a flat list with no history. v5.1 introduces
per-slot **version history**:

```
Astro's Playroom — Save Data                                  [Backup all]

User: primary ▾                          Auto-backup: ●ON (keep last 10)

┌─ Slot 1 — Main Save ────────────────────────────────────────────────┐
│ Live:   2.3 MB   2025-07-30 14:22   CRC 4a8f…   [Backup] [USB ⬇]    │
│ Versions (7):                                                        │
│   v7  2025-07-30 14:22  2.3 MB  CRC 4a8f…   live · current          │
│   v6  2025-07-28 09:10  2.3 MB  CRC 7c12…   [Restore] [Compare ⤚]   │
│   v5  2025-07-25 20:01  2.2 MB  CRC b9d0…   [Restore] [Compare ⤚]   │
│   …                                                                  │
│   [Show all 7]        Retention: keep last 10  [Purge older…]       │
└──────────────────────────────────────────────────────────────────────┘
┌─ Slot 2 — NG+ ──────────────────────────────────────────────────────┐
│ …                                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

- Each backup is a zip (the engine's existing `<title_id>.zip` format
  from `save_archive.rs`) stored in a client-managed
  `saves/<title_id>/<slot>/vN.zip` with a sidecar `manifest.json`
  recording `{version, ts, size, crc32, blake3, note}`.
- **Auto-backup** (toggle, default ON for the live slot): on every
  "Backup now" or before every launch (configurable), a new version is
  written. Retention "keep last N" (default 10) auto-purges oldest.
- **CRC + BLAKE3** of every version is stored in the manifest; the live
  save's CRC is computed on read so the "current" line shows it without
  a separate op.

### 8.2 Compare / diff (closes #9)
"Compare ⤚" opens a side-by-side of two versions' manifests:
- Size delta, CRC change (red/green), file list inside the PFS image
  where readable, mtime per file.
- For PS4 saves (where the image internals are visible after prefix
  strip — see `save_archive.rs` logic), a structural diff (added /
  removed / changed inner files) is shown.
- For PS5-native sealed images, compare is structural (size + hash)
  only; the UI is honest: "Sealed PS5 save — showing size/hash diff."

### 8.3 Mobile pattern
Per v5-design §9.3, each slot row collapses to a kebab (⋮) menu:
Backup / Restore / USB out / USB in / Versions / Compare. Keeps the row
touch-friendly (44 px hit) instead of 4 inline buttons.

### 8.4 USB restore verify (closes #10)
Restoring over a live save is dangerous. Flow:

```
[Restore from USB…] → pick file
  ↓
  ┌─ Verify before overwrite ───────────────────────────────────┐
  │ Selected: sdimg_CUSA00506 (PS4) · 2.3 MB · CRC a1b2…       │
  │                                                            │
  │ CRC32 of USB file:   a1b2c3d4   ✓ matches manifest         │
  │ BLAKE3 of USB file:  9f8e…      ✓ matches manifest         │
  │                                                            │
  │ ⚠ This will OVERWRITE the live save (CRC 4a8f…).           │
  │                                                            │
  │ [Back up live save first ✓]   [Cancel]  [Overwrite]        │
  └────────────────────────────────────────────────────────────┘
```

- Before any overwrite, the engine computes **CRC32** (via the existing
  `crc32_file` op) **and BLAKE3** (`fs_blake3_hash`, already wired at
  `commands/diagnostics.rs:104,157`) of the candidate, compares to the
  manifest shipped with the backup, and **refuses** on mismatch with a
  clear "File corrupted — CRC mismatch" error. No silent overwrite.
- "Back up live save first" is checked by default → the current live
  save becomes version v(N+1) before overwrite, giving a true undo.
- Format-aware: the existing `save_archive` logic (strip `sdimg_` for
  PS4, keep for PS5-native, re-add on restore) runs unchanged; the Hub
  just wraps it with verification.

### 8.5 Edge cases
- PS4 vs PS5 saves coexist (`kind` field from `SaveEntry`); grouped
  under sub-headers "PS5 saves" / "PS4 saves".
- Multiple users: `User:` selector (mirrors `list_saves(user_id)`).
- Slot has zero backups → "No versions yet. [Backup now]".
- Restore while game is running → blocked: "Close *Astro's Playroom*
  before restoring saves." (Live save files are locked by the OS.)

---

## 9. DLC / Add-on Management (closes #2)

### 9.1 Add-ons tab
```
Astro's Playroom — Add-ons                       2 installed / 4 known

┌─ Installed ─────────────────────────────────────────────────────────┐
│ ✓ Cosmetic Pack        120 MB   v1.00   2025-03-20   [Uninstall]    │
│ ✓ Soundtrack           85 MB    v1.00   2025-03-20   [Uninstall]    │
└──────────────────────────────────────────────────────────────────────┘
┌─ Available (in your PKG library) ───────────────────────────────────┐
│ ○ Expansion: Frozen Wilds   4.1 GB   v1.03   [Install]   ⓘ         │
│ ○ Avatar Pack               40 MB    v1.00   [Install]              │
└──────────────────────────────────────────────────────────────────────┘
┌─ Available on PSN (informational) ──────────────────────────────────┐
│ 12 more add-ons on the Store. [Open store page] (needs PSN sign-in) │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 Data flow
- DLC is identified by **content category `ac`** in `pkgLibrary`
  (`state/pkgLibrary.ts`) and by `content_id` suffix `…AC` in the
  payload (`payload/src/bgft.c:1547`).
- "Installed" set: scanned from `/user/addcont/<title_id>/` (PS5) /
  equivalent, joined with `pkgLibrary` per-content_id state (the
  v3.3.8 fix that distinguishes a specific DLC from the base).
- "Available (in your PKG library)": `ac` PKGs whose base title_id
  matches, that are **not** in the installed set.
- "Available on PSN": fetched from TMDB/store metadata for discovery
  only — ps5upload does not install from PSN.

### 9.3 DLC install
- Honors the existing base→update→DLC ordering; the Hub shows it as a
  unified job in Tasks.
- If the base game isn't installed, [Install] is disabled with tooltip
  "Install *Astro's Playroom* first" (the engine already returns
  `err_install_enoent_dlc` for this case — surfaced as a helpful row
  hint instead of an error toast).
- Multiple DLC selected → batch install, one job, per-item progress.

### 9.4 DLC uninstall
- Uses the same `app_unregister` path (`lib.rs:1640`) for add-ons that
  registered a tile; for add-on data folders, a targeted FS delete under
  `/user/addcont/<title_id>/<content_id>/`.
- Always preceded by a confirmation naming the DLC + size; never the
  base game.

### 9.5 Edge cases
- Region mismatch (EU DLC on US base) → warn before install; engine
  already detects via content_id prefix.
- Corrupt/missing DLC folder → shows "⚠ data folder missing" with a
  clean-up suggestion.
- PS4-emulator DLC → handled identically; grouped under a "PS4 add-ons"
  subheader.

---

## 10. Integrity Verification (closes #3)

The engine already has both primitives: `crc32_file` (fast, casual
corruption) and `fs_blake3_hash` (cryptographic). The Hub turns them
into a first-class per-game action in the **Storage tab**.

### 10.1 How it works
1. On first verify, the engine computes a manifest:
   ```
   /user/app/<title_id>/app.pkg          BLAKE3  …
   /user/app/<title_id>/sce_sys/param.sfo BLAKE3 …
   /user/appmeta/<title_id>/icon0.png    BLAKE3 …
   ```
   Persisted at `saves/<title_id>/.integrity.manifest.json` (roams with
   the roster) plus a copy on the PS5 at
   `/data/ps5upload/integrity/<title_id>.json` for cross-device checks.
2. On subsequent verify, recompute and diff:
   - All match → "✓ Verified (N files, BLAKE3)" with timestamp.
   - Mismatch → list of changed files with old vs new hash, a "likely
     cause" hint (modified PKG = reinstall; missing icon = re-enrich),
     and actions: [Reinstall game] [Re-fetch artwork] [Update manifest].
3. Two buttons in the UI:
   - **Verify (BLAKE3)** — thorough, recommended.
   - **Verify (CRC32)** — ~5× faster, catches bit-rot/tamper, fine for
     a quick check.

### 10.2 When it runs automatically
- After any install / update / DLC install completes (a free byproduct).
- Optional schedule (per-roster setting): weekly integrity sweep of all
  installed titles, results surfaced as Tasks entries.

### 10.3 Edge cases
- Files ps5upload can't read (permissions) → marked "⚠ unreadable"
  rather than failing the whole verify.
- A legitimately patched SDK (`param.sfo` changed on purpose) shows as
  a mismatch with a "SDK changed via SDK Changer — [Accept as new
  baseline]" action so it stops being flagged.
- Very large game (100 GB+): verify streams and reports progress (one
  unified job in Tasks), no UI freeze.

---

## 11. Uninstall + Cleanup (closes #1, #8)

### 11.1 Uninstall flow
From the header [🗑 Uninstall] or Storage → Danger zone:

```
┌─ Uninstall Astro's Playroom? ───────────────────────────────────────┐
│                                                                     │
│  This will remove:                                                  │
│    • Game data            3.2 GB   /user/app/CUSA00506              │
│    • App metadata         1.2 MB   /user/appmeta/CUSA00506          │
│    • Home screen tile               (unregister via app.db)         │
│                                                                     │
│  This will PRESERVE (your call below):                              │
│    ☑ Save data           6.9 MB   (3 slots, 7 versions)             │
│    ☑ Cheats & profiles           (12 cheats, 3 profiles)            │
│    ☑ Captures            14 shots, 3 clips                          │
│    ☐ DLC packages               (2 add-ons, 540 MB)                 │
│    ☑ TMDB artwork / metadata                                       │
│    ☑ Integrity manifest                                            │
│                                                                     │
│  Reason (optional): [ freeing space ▾ ]                             │
│                                                                     │
│  Type "CUSA00506" to confirm:  [__________]                         │
│                                                                     │
│              [Cancel]            [Uninstall]                        │
└─────────────────────────────────────────────────────────────────────┘
```

- Uses the existing `app_unregister` (FTX2) for the tile + a targeted
  FS delete of `/user/app/<title_id>` and `/user/appmeta/<title_id>`.
- **System-app guard** (mirrors the i18n strings
  `installed_uninstall_confirm_system`): NPXS* titles require an extra
  "I understand this is a system app" checkbox.
- The game's tile in the grid becomes "Installable" (if a PKG still
  exists in the library) or disappears (if not). Saved data, cheats,
  captures, profiles, artwork, and the integrity manifest are all
  preserved by default — they're how you'd pick back up after
  reinstalling.
- Confirmation requires typing the title_id (or, on mobile,
  long-pressing the button for 1.5 s) to prevent fat-finger uninstalls.

### 11.2 Cleanup after uninstall (closes #8)
After the uninstall above, the Hub offers a follow-on sweep for
**orphaned** data across all titles:

```
Console → Storage → Clean up orphaned game data

Orphaned = data on the PS5 whose base title is no longer installed.

Found 4 orphans (2.1 GB):
  ☑ Saves for CUSA01234  (uninstalled 2025-06-10)      12 MB
  ☑ Cheats for CUSA07889 (uninstalled 2025-06-12)      3 MB
  ☐ Captures for CUSA01234                             480 MB
  ☑ DLC pkg for CUSA03456                              1.6 GB

[Back up selected first]   [Delete selected]
```

- Sources scanned: `/user/home/<uid>/savedata*/<title_id>/` for saves
  not in the installed set; cheat files whose title_id isn't installed;
  capture folders whose title_id is gone; `dlc/` PKGs whose base is
  gone; stale appmeta.
- Never auto-deletes — user selects. "Back up selected first" zips
  saves/captures to the host before removal (one unified job).
- Also reachable from Storage → Danger zone → [🧹 Clean up orphaned
  data…] which opens this same console-level view.

### 11.3 Edge cases
- Uninstall while running → blocked ("Close the game first").
- Uninstall of a title with installed DLC → warning that DLC becomes
  unplayable until the base is reinstalled; DLC data preserved unless
  the user opts to delete it (checkbox above).
- Disk full mid-uninstall → rollback message + retry; partial state is
  recoverable because the FS deletes are last after the app.db
  unregister.

---

## 12. Offline Mode

When the PS5 is disconnected (roster shows the console as offline, or
the telemetry stream is down), the Hub stays **browsable** for
planning, and clearly marks what needs the console.

| Area | Offline-browsable? | Notes |
|---|---|---|
| Header identity (name, title_id, art) | ✓ | From last cached `/api/ps5/library`. RUNNING pill hidden. |
| Overview | ✓ (cached) | "Last synced 2 h ago" banner. |
| Cheats list & profiles | ✓ | Profiles are client-side; cheat file contents cached. |
| Apply / Launch / Download-more | ✗ | Disabled with "PS5 offline" tooltip. |
| Saves list | ✓ (cached) | Version history is client-side; Backup/Restore disabled. |
| Media | ✓ (cached thumbnails) | Full-res download disabled. |
| Add-ons / Updates | ✓ (from pkgLibrary) | Install disabled. |
| Play Time | ✓ (cached) | From local activity history store. |
| Storage / Verify / Uninstall | ✗ | Needs the console. |
| Favorites / Collections / Sort / Filter | ✓ | All client-side. |
| Multi-select batch | ✓ to plan; ✗ to execute | "Will run when PS5 reconnects" queue option. |

The grid itself loads entirely from the cached library response, so
users can plan a session, queue installs/backup jobs (they'll execute
on reconnect), and manage profiles/collections without the console.

---

## 13. Cross-cutting design notes

- **Touch targets.** Every header action, tab, checkbox, and row action
  is ≥44×44 px (v5-design §8.1). Mobile uses kebab menus on dense rows.
- **Job unification.** Every long-running action here (install, verify,
  backup-all, batch uninstall, DLC download) routes through the unified
  `jobs` + SSE system (v5-design §6) so progress lands in Tasks.
- **Identity everywhere.** `title_id` is the only join key — in routes,
  deep links, jobs metadata, and notifications — so a job result always
  knows which Hub to open.
- **Accessibility.** Status chips have `aria-label`s ("12 of 15 cheats
  active"), the RUNNING pill has `role="status"`, and the tab bar is a
  real `role="tablist"` with arrow-key navigation.
- **Reuses existing engine primitives** rather than inventing new ones:
  `app_unregister`, `crc32_file`, `fs_blake3_hash`, `pkgLibrary`
  ordering, `save_archive` prefix logic, `tmdb_fetch`, the activity
  tracker (P0-2), cheat conflict manifest from payload. No new FTX2
  frame types required for v5.1 except the optional
  `GET /api/ps5/cheats/engines` (a small static manifest) and the
  `GET /api/ps5/library[/:title_id]` aggregator join.
