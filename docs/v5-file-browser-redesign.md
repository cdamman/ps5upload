# ps5upload v5.0 — Unified File Browser (Revised Design)

> **Status: historical.** This document is kept for the reasoning
> behind decisions that have since shipped. It describes intent at the
> time of writing, not current behaviour — check the code, `CHANGELOG.md`
> or `FAQ.md` before relying on anything here.

> **Scope:** Revises §3, §4-E, §9.3, and Appendix B of `v5-design.md`.
> The Files tab consolidates 6 v4 screens (FileSystem, Search, Volumes,
> DiskUsage, SmbBrowser, FTP-Server toggle) into **one browser** and
> closes the 8 feature gaps + 7 orphaned-API gaps surfaced by the
> v5 audit. This is the plan of record for the browser surface.
>
> **Status:** PLANNING — no code written yet. Builds on existing
> infrastructure: `fsClipboard`, `fsBulkOp`, `fsDownloadOp`,
> `recentPaths`, `fsNavigation` stores and the
> `startTransferDownloadZip` API.

---

## Table of Contents

1. [Design Goals & Inspiration](#1-design-goals--inspiration)
2. [Overall Layout](#2-overall-layout)
3. [Location Sidebar](#3-location-sidebar)
4. [Toolbar](#4-toolbar)
5. [View Modes](#5-view-modes)
6. [Search Mode](#6-search-mode)
7. [Bookmarks / Quick-Access](#7-bookmarks--quick-access)
8. [Preview / Open-With](#8-preview--open-with)
9. [Batch Operations](#9-batch-operations)
10. [Archive & Checksum](#10-archive--checksum)
11. [Cross-Location Operations](#11-cross-location-operations)
12. [Integration Points](#12-integration-points)
13. [Mobile-Specific Design](#13-mobile-specific-design)
14. [Power-User Tools](#14-power-user-tools)
15. [Data Flows & State](#15-data-flows--state)
16. [Keyboard Shortcuts](#16-keyboard-shortcuts)
17. [Migration & Backward-Compat](#17-migration--backward-compat)
18. [Phased Implementation](#18-phased-implementation)

---

## 1. Design Goals & Inspiration

**Target experience:** as good as Files.app on macOS and Solid Explorer
on Android — one pane that adapts to context, not six browsers that
happen to share a filesystem.

| Gap from audit | Closed by section |
|----------------|-------------------|
| 1. Mobile drag-drop unspecified | §11.3 (clipboard metaphor), §13 |
| 2. No preview / open-with | §8 |
| 3. No bookmarks | §7 |
| 4. No batch rename | §9.3 |
| 5. No persistent mirror job | §11.4 |
| 6. No archive-out for arbitrary folders | §10.1 (API exists, UI missing) |
| 7. Checksum buried, single-file | §10.2 |
| 8. DiskUsage read-only | §5.4, §9.1 (delete from within view) |

**Existing infrastructure we reuse (not rebuild):**
- `useFsClipboardStore` — cut/copy with per-host stash on console switch
- `useFsBulkOpStore` — per-host delete/move/copy progress (survives navigation)
- `useFsDownloadOpStore` — per-host tracked download with runId abort
- `useRecentPathsStore` — MRU paths in localStorage (becomes the seed for bookmarks)
- `useFsNavStore` — one-shot `requestPath` for cross-screen deep-links
- `startTransferDownloadZip` API — folder→zip streaming download (already shipped)
- `crc32File`, `fsBlake3Hash` APIs — checksum primitives (already shipped)
- `smbListShares`, `smbListDir`, `smbDownloadFile` APIs — SMB read primitives
- `ftpStart`, `ftpStatus` — FTP toggle primitives

---

## 2. Overall Layout

### 2.1 Desktop (≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Files    [PS5 ▾]  / data / saves ◂ ▸              [⌘K] [⚙]              │
├──────────┬───────────────────────────────────────────────────────────────┤
│ LOCATIONS│ [◀ Path ▸ breadcrumb bar                                  ]   │
│          │ [↑ Upload] [⤓ Download] [🔍] [+Folder] [☐Sel] [≡List|▦Grid|│]│
│ 📁 PS5   │ ┌─────────────────────────────────────────────────────────┐ │
│   SSD    │ │ ☐ Name              Size   Modified   Perms   Checksum  │ │
│   USB0   │ │ ☐ saves/            ─      2d ago     0755     —        │ │
│   USB1   │ │ ☐ pkg/              ─      1h ago     0755     —        │ │
│ 📁 SMB    │ │ ☐ theme.zip        2.1 MB  3d ago     0644     crc▶    │ │
│   nas    │ │ ...                                                      │ │
│ 📁 FTP    │ └─────────────────────────────────────────────────────────┘ │
│ 📁 Local  │                                                             │
│          │  ── Bookmarks ──                                            │
│ ★ Quick  │  ★ /data/saves   ★ /mnt/usb0   ★ nas://media/Movies        │
│ ⏱ Recent │  ⏱ /user/trophy  ⏱ /data/screenshots                       │
│          │                                                             │
│ ── Tools ─│ ┌─ Clipboard ───────────────────────────────────────────┐ │
│ ⚙ Disk    │ │ ✓ 3 items cut from /data/saves  [Paste] [Esc to clear]│ │
│ 🔧 fsck   │ └──────────────────────────────────────────────────────────┘ │
│ 🗄 app.db │                                                             │
│ 📜 syslog │  ┌─ Bulk op ──────────────────────────────────────────────┐│
│           │  │ Moving 12/47 → /mnt/usb0/backup  [███░░░] [Stop]       ││
└──────────┴───────────────────────────────────────────────────────────────┘
```

**Three persistent regions:**
1. **Location sidebar** (left, 240px, collapsible to 56px icon-rail)
2. **Browser pane** (center — path bar + toolbar + file list, the only thing that scrolls)
3. **Context rail** (right, 320px, optional — preview, checksum, properties)

On mobile the context rail becomes a bottom sheet and the location sidebar
becomes a pull-down location switcher (§13).

### 2.2 Two-window mode (opt-in, desktop only)

Power users can split the browser pane into two independent windows:
`View → Split Horizontal/Vertical`. Each window has its own location +
path + selection + clipboard target. This is **not** dual-pane — it's
two full browsers side by side, sharing the same stores. Drag between
them is direct (no clipboard).

On mobile this collapses to one pane + clipboard (§11.3).

---

## 3. Location Sidebar

Each location is a **backend adapter** implementing a common interface:

```ts
interface FsLocation {
  id: string;                          // "ps5:ssd", "smb:nas:media", …
  kind: "ps5" | "smb" | "ftp" | "local";
  label: string;                       // "PS5 SSD", "nas / Media"
  icon: ReactNode;
  state: "connected" | "disconnected" | "connecting" | "error";
  statusText?: string;                 // "12.4 GB free of 667 GB"
  list(path: string): Promise<DirEntry[]>;
  // read/write operations are capability-gated (§3.5)
  capabilities: LocationCapabilities;
}
```

### 3.1 PS5 Internal (`kind: "ps5"`, source: `/api/ps5/volumes`)

- One entry per mounted volume from `ps5_volumes` (already shipped).
  Typical: `SSD` (`/data`), `USB0` (`/mnt/usb0`), `USB1` (`/mnt/usb1`).
- **Connected:** green dot, free/total bytes in secondary text.
- **Disconnected USB:** greyed, "Ejected — reconnect to browse".
  Tap → `fsMount`/`fsUnmount`.
- **Missing PS5:** entire location section collapses to a single card
  "PS5 not connected" with a "Connect" button (deep-links to Home → Connect).

### 3.2 SMB (`kind: "smb"`, source: `/api/smb/list-shares`)

- Section header: **SMB Shares** + `＋ Add server`.
- Each saved server is a sub-tree: `nas` → `Media`, `Photos`, …
- **Disconnected:** yellow dot, "Host unreachable — retry in 5s".
  Auto-retry with backoff (3 attempts, then manual).
- Stored servers persist in localStorage (roster alongside PS5 consoles).
- First connection prompts for credentials (stored in OS keychain via
  Tauri `keytar`-equiv, never in localStorage).

### 3.3 FTP (`kind: "ftp"`)

- Single entry: **PS5 FTP Server** with a toggle (`ftpStart`/`ftpStatus`).
- When ON: indented child entry "Browse via FTP" that opens the FTP
  filesystem view (read-mostly; FTP write is best-effort and flagged).
- When OFF: child shows "FTP server is off — turn on to browse".
- This is the *only* place the FTP toggle lives in v5 — it disappears
  from Console → Network Services per the audit (orphan check).

### 3.4 Local (`kind: "local"`)

- The host machine's filesystem via `LocalPathPicker` (already shipped,
  uses Android Scoped Storage picker on mobile).
- Default root: last-used directory.
- **Capabilities:** full read/write (this is the download target).

### 3.5 Capability gating

Not all locations support all operations. The toolbar and context menu
**grey out** unsupported actions per-location rather than failing at
runtime:

| Capability | PS5 SSD | PS5 USB | SMB | FTP | Local |
|------------|:-------:|:-------:|:---:|:---:|:-----:|
| Read       | ✓ | ✓ | ✓ | ✓ | ✓ |
| Write      | ✓ | ✓ | ✓ (ro flag) | ⚠ best-effort | ✓ |
| Delete     | ✓ | ✓ | ✓ | — | ✓ |
| Rename     | ✓ | ✓ | ✓ | — | ✓ |
| chmod      | ✓ | ✓ | — | — | ✓ |
| Mount/Unmount | SSD: — | ✓ | — | — | — |
| Checksum (remote) | ✓ | ✓ | ⚠ download first | ⚠ | ✓ |
| Archive (folder→zip out) | ✓ | ✓ | ✓ | ✓ | ✓ |

The `LocationCapabilities` object is the single source of truth; every
menu builder consults it. This is what prevents "PS5 not connected"
errors from ever appearing on a greyed-out button.

### 3.6 Cross-links from DiskUsage / Volumes

The old DiskUsage and Volumes screens become **views inside the browser**
(§5.4) — but their analysis data drives cross-links back here:

- DiskUsage "this folder is 12 GB" → "Open in Files" button jumps to
  that exact path with the folder selected.
- Volumes "USB0 ejected" → side-bar status reflects it live.

No more "3 screens + 2 context switches" workflow.

---

## 4. Toolbar

Always visible above the file list. Adapts to the current location's
capabilities and the current selection.

### 4.1 Always-available actions

| Action | Icon | Shortcut | Behavior |
|--------|------|----------|----------|
| **Upload** | ↑ | ⌘U | Native picker (multi). If a `.zip/.7z/.rar` is picked, offers "Extract on upload" (existing flow). If a `.pkg` is picked, intercepts → "This looks like a PKG — install it?" (§12.1). |
| **Download** | ⤓ | ⌘D | Selection → local. If a folder is selected, default to **zip** (`startTransferDownloadZip`); offer "download as folder tree" as the alt. |
| **New Folder** | ＋ | ⌘⇧N | Inline rename. |
| **Search** | 🔍 | ⌘F | Toggles search mode (§6). |
| **View mode** | ≡/▦/🌳/🎯 | ⌘1–4 | list / grid / tree / disk-usage (§5). |
| **Sort** | ↕ | ⌘⇧S | name / size / modified / kind, asc/desc, folders-first toggle. Persisted per-location. |
| **Select all** | ☐ | ⌘A | — |
| **Multi-select** toggle | ☑ | ⌘⇧A | Persistent selection mode for touch (§9.2). |
| **Bookmark this path** | ★ | ⌘D (hold) | Adds current path to Bookmarks (§7). |

### 4.2 Selection-aware actions (appear only when ≥1 row selected)

| Action | Appears when | Behavior |
|--------|--------------|----------|
| **Cut / Copy** | ≥1 selected | Seeds `fsClipboard` (cut vs copy). Banner appears (§11). |
| **Paste** | clipboard non-empty **and** current loc writable | Performs move/copy bulk op via `fsBulkOp`. |
| **Rename** | exactly 1 selected | Inline edit. |
| **Batch rename** | ≥2 selected | Opens modal (§9.3). |
| **Delete** | ≥1 selected, loc deletable | Confirm → bulk delete via `fsBulkOp`. |
| **chmod** | ≥1 selected, loc chmod-capable | Modal (octal or per-flag checkboxes). |
| **Archive (→zip)** | ≥1 selected, read-capable | Streams to local zip via `startTransferDownloadZip`. |
| **Checksum** | ≥1 selected | Modal or context rail (§10.2). |
| **Preview / Open with** | exactly 1, previewable kind | Opens preview (§8). |

### 4.3 Toolbar responsiveness

- Desktop: full button row, icon + label.
- Tablet (768–1023px): icon + tooltip; labels hidden.
- Mobile (< 768px): collapses to a 3-button cluster
  `[↑] [⤓] [⋮]` where `⋮` opens a bottom sheet with the rest (§13.4).

---

## 5. View Modes

Four view modes share the same data source (`FsLocation.list`). Switching
is instant — no re-fetch. Persisted per-location in localStorage.

### 5.1 List view (default)

```
☐  Name              Size      Modified        Perms   ▾
─────────────────────────────────────────────────────────
▶  saves/            —         2d ago          0755
▶  pkg/              —         1h ago          0755
   theme.zip         2.1 MB    3d ago          0644    crc▶
   param.sfo         1.2 KB    3d ago          0644    sfo▶
```

- Sortable columns (click header).
- Row height: 36px dense / 44px touch (toggle in Settings).
- Inline icon by kind: folder / image / text / pkg / save / archive.
- Hover row reveals a subtle action strip on the right (rename, more).

### 5.2 Grid view (media-first)

```
┌────────┐ ┌────────┐ ┌────────┐
│ [thumb]│ │ [thumb]│ │ [thumb]│
│        │ │        │ │        │
├────────┤ ├────────┤ ├────────┤
│IMG_0042│ │IMG_0043│ │save_01 │
│1.2 MB  │ │1.4 MB  │ │4.1 MB  │
└────────┘ └────────┘ └────────┘
```

- Thumbnails for `png/jpg/webp/bmp` (cached, generated lazily).
- PKG tiles show cover art (param.sfo preview).
- Folder tiles show a 2×2 thumbnail collage of contents.
- Tile size: 128 / 160 / 192 / 256 px (zoom slider).
- Long-press / right-click = context menu.

### 5.3 Tree view

```
▼ 📁 /
  ▼ 📁 data
    ▼ 📁 saves        ◀ bookmarked
      ▶ 📁 CUSA00506
      ▶ 📁 CUSA12345
    ▶ 📁 pkg
  ▼ 📁 mnt
    ▶ 📁 usb0         ◀ ejected
```

- Lazy-expand on click (no full tree prefetch).
- Multi-select across branches via ⌘-click.
- Best for: navigating deep paths, dragging across branches.

### 5.4 Disk-Usage view (replaces the standalone DiskUsage screen)

This is the key insight from the workflow audit: **disk usage is a view,
not a screen**. Same path, same selection, same toolbar — just a
different rendering of the same `list` data enriched with size
aggregation.

```
/data  ━━━━━━━━━━━━━━━━━━━━━━━━━━ 412 GB of 667 GB
├ saves      ████████████████░░░ 187 GB  (45%)  ◀ biggest
├ pkg        ████████░░░░░░░░░░░  98 GB  (24%)
├ themes     █░░░░░░░░░░░░░░░░░░  11 GB  ( 3%)
└ other      ░░░░░░░░░░░░░░░░░░░   2 GB  ( <1%)
```

- **Sunburst + treemap toggle** (collapsible).
- Click any segment → drills into that subfolder (breadcrumb updates).
- **Selection works the same way** — checkbox on the row.
- **Right-click → Delete works here** (closes audit gap #8): no more
  "must re-navigate in FileSystem".
- **Right-click → "Open in Files"** is a no-op here (we're already in
  Files) but available from the standalone Dashboard widget if we keep one.
- Size aggregation via existing FS size APIs; cached 60s with manual
  refresh (`⟳ Refresh sizes` button, always visible in this view).

### 5.5 Switching views

- Toolbar buttons `≡ / ▦ / 🌳 / 🎯` (list / grid / tree / disk-usage).
- `⌘1` `⌘2` `⌘3` `⌘4`.
- View mode persists per **location + path-prefix** (so `/data/screenshots`
  remembers grid, `/data/saves` remembers list).

---

## 6. Search Mode

Search is a **mode** of the browser, not a separate screen. Triggered
from the toolbar (`🔍` or `⌘F`) it morphs the path bar into a search bar
without leaving the screen.

### 6.1 What gets searched

A scope chip-row appears under the search bar:

```
🔍 goldHEN                  [✕]
Scope:  ● Here (/data)  ○ Whole volume  ○ All PS5  ○ SMB too  ○ Filename  ○ Content
Filter: ☐ Files  ☐ Folders  ☐ > 100 MB  ☐ modified < 7d  ☐ kind = pkg
```

- **Filename** — glob/regex on basename. Fast (readdir-walk).
- **Content** — opt-in, slow, requires read capability. Streams results.
- **Scope** — default to current directory; expandable up.
- **Filters** — kind, size range, mtime range, perms mask.

### 6.2 Results display

Results render **in the same file list** with the search bar replacing
the path bar. Each row shows its full path in a dimmed secondary line:

```
🔍 goldHEN                                    4 results in /data  (0.8s)
─────────────────────────────────────────────────────────────────
   goldHEN.config.json         2 KB   /data/                        json▶
   goldHEN_2.4.bin           412 KB   /data/saves/CUSA00506/        bin▶
   goldHEN.txt                  0 B   /mnt/usb0/backup/             text▶
```

- Click row → navigates to that path (exits search mode).
- `Esc` → exits search mode, restores previous path.
- Search persists across location switches if scope includes them.

### 6.3 Replaces v4 Search screen

The v4 Search screen (≈400 LOC) is deleted; its filters move into the
chip row. Saved searches become Bookmarks (§7).

---

## 7. Bookmarks / Quick-Access

Closes audit gap #3.

### 7.1 Two sections in the sidebar

```
★ Bookmarks
   ★ /data/saves
   ★ /data/screenshots
   ★ nas://Media/Movies
   ★ /mnt/usb0/backup

⏱ Recent (auto, MRU 8)
   ⏱ /user/trophy              2m ago
   ⏱ /data/pkg                 1h ago
```

- **Bookmarks** — user-pinned paths (★ in toolbar or context menu).
  Persist in localStorage (per the existing `recentPaths` pattern, but a
  new `bookmarksStore` with no MRU cap, user-ordered, drag-to-reorder).
- **Recent** — the existing `useRecentPathsStore`, unchanged. Capped at 8.

### 7.2 Default bookmarks (seeded on first run)

These seed every fresh install based on common PS5 paths surfaced by
the audit and existing screens:

| Bookmark | Path | Why |
|----------|------|-----|
| Saves | `/data/.../savedata` | #1 user task |
| Screenshots | `/data/screenshots` | previously orphaned to own screen |
| Video clips | `/data/video` | previously orphaned to own screen |
| PKG drops | `/data/pkg` | install staging |
| Themes | `/data/themes` | — |
| Trophy | `/user/trophy` | surfaced via recentPaths already |
| USB0 | `/mnt/usb0` | extended storage |

Users can delete any default; they're not sacred.

### 7.3 Bookmark metadata

Each bookmark stores: `path`, `label` (editable), `locationId`, `icon`
(optional override), `color` (optional). Right-click → Edit / Remove /
"Open in new split window".

### 7.4 Bookmark cross-location

Bookmarks are not PS5-only — `nas://Media/Movies` and `local://~/PS5
Backups` are first-class. Selecting one switches the active location
**and** the path in one action.

---

## 8. Preview / Open-With

Closes audit gap #2. Preview is a **right-side context rail** on desktop
(320px) and a **full-screen sheet** on mobile. Triggered by single-click
in grid view, or by the `▶` affordance in list view, or `Space` (mac
Quick-Look style).

### 8.1 Supported formats

| Format | Detection | Renderer | Notes |
|--------|-----------|----------|-------|
| **PNG / JPG / WEBP / BMP** | extension | `<img>` with zoom | Thumbnail first, full on demand. EXIF side-panel. |
| **JSON** | extension + magic | syntax-highlighted tree | Pretty-printed; collapse/expand. |
| **TXT / LOG / MD** | extension | monospaced text | Tail mode for `.log` (auto-scroll). |
| **SFO (param.sfo)** | magic `0x00504346` or ext | structured key/value table | The PS5's param.sfo — title, title_id, SDK, version. Decoded via existing `parseSfo` util. |
| **BIN (small)** | < 1 MB | hex dump | paged 4 KB at a time. |
| **PKG** | extension | metadata card | title_id, version, size, contents list from `sevenzInspect`-style preview. |
| **ZIP / RAR / 7Z** | extension | archive browser | Lists entries (read-only) using existing `zipInspect`/`rarPreview`/`sevenzInspect`. "Extract here" button. |
| **MP4 / WebM (clips)** | extension | `<video>` | For the screenshots/videos severance. |

Unsupported → "No preview available — Download to view" + "Open with…"
(external app launch via Tauri `open`).

### 8.2 Preview navigation

- `↑` / `↓` previews the previous/next file in the current listing
  (Quick-Look style) — no list re-render.
- `Esc` closes.
- Preview pane state persists per session but is closed by default on
  mobile (uses full-screen sheet instead).

### 8.3 "Open with" submenu

Right-click any file → **Open with →**
- Preview (this app)
- Install as PKG *(if `.pkg` — §12.1)*
- Restore as save *(if `.zip` containing `savedata` — §12.2)*
- View in Media *(if screenshot/video — §12.3)*
- Edit checksum *(if hashing workflow — §10.2)*
- System default (Tauri `open`)

---

## 9. Batch Operations

Closes audit gaps #4 and #8.

### 9.1 Multi-select

- **Desktop:** ⌘-click (add), ⇧-click (range), ⌘A (all).
- **Mobile:** long-press enters multi-select mode (haptic); tap toggles.
  A persistent selection bar appears at the bottom (§13.5).
- Selection persists across view-mode switches (same data source).
- Selection **survives navigation** for the active location only — moving
  to another location clears it (prevents "deleted the wrong folder").

### 9.2 Bulk delete from Disk-Usage view

Closes audit gap #8. In disk-usage view, selecting the top-3 space hogs
and pressing Delete runs the same `fsBulkOp` delete loop as the file
list — no re-navigation. The disk-usage bars recompute after delete.

### 9.3 Batch rename modal

Closes audit gap #4. Opens for ≥2 selected items.

```
Batch rename — 200 items
─────────────────────────────────────────
Pattern:  [Save_{n:03}.json          ]    Preview:
Replace:  [spaces → underscores      ]     Save_001.json
Sequence: start [1] step [1] pad [3]       Save_002.json
Regex:    [□ enable  find [_]  repl [-]]   Save_003.json
Case:     [lower ▾]                          …
─────────────────────────────────────────
Conflict policy:  ○ Skip  ● Append (1)  ○ Overwrite  ○ Cancel all
[Cancel]                              [Rename 200 items]
```

**Operations (composable):**
1. **Pattern** — `{n}` counter with padding, `{name}` original, `{ext}`,
   `{date}`, `{parent}`.
2. **Find/replace** — literal or regex.
3. **Case** — lower / upper / title / kebab / snake.
4. **Sequence** — for numbering 001..200.
5. **Strip** — whitespace, leading numbers, etc.

**Live preview** shows first 10 renames; conflicts flagged red inline.
Renames execute atomically where possible (rename-all-or-none for < 50
items; streamed with rollback log for larger sets). All renames route
through `fsBulkOp` for progress + cancel.

### 9.4 Batch chmod modal

Octal input (e.g. `0755`) **or** per-flag checkboxes (owner/group/other
× r/w/x) **or** "add `+x` to everyone". Same preview-then-apply pattern.

### 9.5 Batch download

Multi-select → Download → all files stream into a single local zip via
`startTransferDownloadZip` (folder kind, even if individual files).
Tracks via `fsDownloadOpStore`.

---

## 10. Archive & Checksum

### 10.1 Archive operations (closes gap #6)

**Inbound (already shipped, surfaced in §4.1):**
- Upload `.zip/.7z/.rar` → engine extracts host-side via
  `startTransferZip` / `startTransfer7z` / `startTransferRar`.
- "Extract here" from preview pane for archives already on the PS5.
  **Note:** this engine path does not exist today — the host-side
  `startTransferZip/7z/Rar` family decompresses *during upload*, but
  there is no PS5-side `unzipTo`. Phase 5.1-d adds a thin engine wrapper
  reusing the upload-extract logic against a PS5 source path. Until then,
  the preview pane's "Extract here" is hidden for on-PS5 archives and
  only shown for local/SMB sources (where the existing host-side path
  applies).

**Outbound (API exists, UI was the gap):**
- Any folder (or multi-selection) → **Download as ZIP** uses
  `startTransferDownloadZip(srcPath, destZip, addr, "folder")`.
  This already streams Deflate-on-the-fly — no temp scratch dir.
- Default dest: `~/Downloads/<foldername>.zip` (configurable).
- The v4 limitation "only saves/screenshots can be zipped" was a UI
  restriction, **not** an engine restriction. The browser removes it.

**Archive format choice on download:**
```
Download selection
  ● ZIP (streamed, universal)        default
  ○ TAR (no recompression)           for already-compressed payloads
  ○ ZIP + BLAKE3 manifest            for archival (pairs with §10.2)
```

### 10.2 Checksum verify (closes gap #7)

Today: single-file, buried in a row menu. v5 promotes it to first-class.

**Selection ≥ 1 → Checksum button** opens the context rail:

```
CHECKSUM                       [⟳ recompute]
─────────────────────────────────────────
Selection: 3 items, 187 MB
─────────────────────────────────────────
/data/pkg/foo.pkg
  CRC32   a1b2c3d4   ⏱ 0.4s
  BLAKE3  3f2e…b9c1   ⏱ 1.2s   [copy]

/data/pkg/bar.pkg
  CRC32   deadbeef   ⏱ 0.3s
  BLAKE3  7a8b…11f0   ⏱ 1.1s   [copy]
─────────────────────────────────────────
Compare against local:  [ Choose file… ]
  ✓ PS5 foo.pkg  ==  ~/Downloads/foo.pkg   (BLAKE3 match)
  ✗ PS5 bar.pkg  !=  ~/Downloads/bar.pkg   (CRC32 mismatch — re-download?)
```

**Folder-level:** selecting a folder hashes every file in the tree,
produces a manifest (`manifest.b3sum`), downloadable alongside the zip
from §10.1. Re-running against a downloaded copy verifies the transfer.

**PS5↔local compare:** the rail has a "Compare with local…" button that
opens a local picker, hashes both sides, and shows diff. This closes
the "transfer integrity" loop that was previously impossible.

**Where it lives in the menu:** promoted from a row-submenu to the
selection-aware toolbar (`#` icon) and to the context rail — visible
whenever ≥1 row is selected.

---

## 11. Cross-Location Operations

### 11.1 The clipboard is the source of truth

The existing `useFsClipboardStore` is extended to carry a `sourceLocationId`
alongside each item, so a paste knows whether it's a same-location move
(trivial) or a cross-location transfer (engine download + upload under
the hood).

```ts
interface ClipboardItem {
  path: string;
  name: string;
  size: number;
  kind?: "file" | "dir" | "game" | "image" | "folder";
  locationId: string;          // NEW — "ps5:ssd", "smb:nas:media", "local:~/Dl"
  // engine handles cross-backend routing transparently
}
```

Cross-location paste is always a **copy** (cut within same location only).
The engine orchestrates: SMB read → temp → PS5 write, with progress in
the unified bulk-op banner.

### 11.2 Desktop drag-and-drop

- **Native DnD** within the app: drag row → drop onto a sidebar location
  or another split-window. Seeds clipboard implicitly + pastes.
- **OS ↔ app DnD:** drop files from Finder/Explorer onto the browser →
  upload (same as Upload button). Drag rows **out** to Finder → download
  to that folder (uses `startTransferDownloadZip` for folders, direct
  download for files).
- **Visual feedback:** drop targets highlight green; invalid (e.g.
  read-only location) highlights red with a "✗ Read-only" badge.

### 11.3 Mobile clipboard metaphor (closes gap #1)

Mobile is single-pane — no dual-pane, no DnD. The clipboard **is** the
cross-location metaphor, surfaced as a persistent **bottom banner**:

```
┌──────────────────────────────────────────────┐
│ 📋 3 items cut from PS5:/data/saves           │  ← always visible once staged
│    saves/  CUSA00506/  CUSA12345/             │
│                            [Paste here] [✕]   │
└──────────────────────────────────────────────┘
```

**Flow:**
1. Long-press a row → multi-select mode → choose **Cut** or **Copy**.
2. Banner slides up from the bottom (above the bottom nav) and stays.
3. User taps a different location in the sidebar (PS5 → SMB → Local…).
4. User navigates to the destination folder.
5. Banner's **Paste here** button becomes active (only when current loc
   is writable). Tap → bulk op runs.
6. Banner clears on success (cut) or stays until ✕ (copy).

**Affordances:**
- Banner is **always visible** once staged — no "did I copy that?"
  uncertainty.
- The **source location** is shown so the user can confirm they're
  pasting what they meant (existing `sourceLabel` pattern).
- If the user switches consoles, the existing per-host stash preserves
  each console's clipboard — banner shows "Switched to PS5-B (different
  clipboard)" when crossing consoles.
- **Edge swipe back** is suppressed while the banner is showing, so
  users don't lose their staging by accident. A confirm dialog guards
  back-out: "Discard 3 staged items?"

This is the Solid Explorer / Files.app pattern adapted to one pane.

### 11.4 Sync / mirror job (closes gap #5)

A persistent "keep this folder mirrored" job. Surfaced from the context
menu of a folder: **"Set up mirror…"**

```
Mirror job
  Source:  ● PS5:/data/saves
  Target:  ● Local:~/PS5 Backups/saves
           ○ SMB:nas/Backups/saves
  Direction:  ➡ One-way (source → target)
  Schedule:   ● On change (watch)   ○ Hourly   ○ Daily 03:00   ○ Manual
  Conflict:   ● Skip identical (by BLAKE3)   ○ Overwrite   ○ Append (1)
  Retention:  keep last [5] snapshots
  [Create mirror job]
```

- Lives in the unified **Tasks** tab as a persistent job type.
- Uses BLAKE3 (§10.2) for change detection — only changed files transfer.
- "On change" uses the engine's existing dir-watch if available, else
  hourly poll.
- This is a new engine job kind (`mirror`) routed through the unified
  job system per v5-design §6.

---

## 12. Integration Points

### 12.1 "This looks like a .pkg → install it" (Upload ↔ InstallPackage)

On upload, the engine's `sevenzInspect`-style preview detects a PKG by
magic. The Upload confirmation dialog becomes:

```
↑ Upload — Astro's Playroom.pkg (3.2 GB)
This file looks like a game package.
   ● Install it (BGFT install to PS5)        ← default for .pkg
   ○ Upload as a regular file to /data/pkg/
[Cancel]  [Install]
```

Conversely, in the browser, right-clicking a `.pkg` that's already on
the PS5 offers **"Install"** — same BGFT path. The v4 Install Package
screen (1254 LOC) is reduced to a confirmation dialog launched from
either Games tab or Files tab.

### 12.2 "This .save → restore it"

Selecting a `.zip` whose contents match a save-data layout shows:
**"Restore as save data"** → routes to the existing restore flow
(previously on the Saves screen, now Game Hub → Saves per v5-design §5).

### 12.3 "This screenshot/video → view in Media"

Right-click a file under `/data/screenshots` or `/data/video`:
**"Open in Media"** → jumps to Games tab → that game's Hub → Media tab
(previously the Screenshots + Videos screens were "artificially severed"
— they now join at the Game Hub while remaining browsable here).

The browser also offers a **"Group by game"** view-mode variant in
grid view for screenshot/video folders, showing tiles grouped under
their owning title_id's cover art.

### 12.4 Cross-link affordances everywhere

| File in browser | Affordance |
|-----------------|------------|
| `.pkg` | Install |
| `.zip` w/ savedata | Restore |
| `.png/.jpg` in screenshots dir | Open in Media |
| `.mp4` in video dir | Open in Media |
| `param.sfo` | "View game →" (jumps to Hub for that title_id) |
| `.bin` cheat file | "Open in Cheats →" (jumps to Hub → Cheats) |
| `app.db` | "Query in app.db →" (§14.5) |

These are **inline chips** on the row in list view, and badges on the
tile in grid view — always one tap away, never buried.

---

## 13. Mobile-Specific Design

### 13.1 Single-pane navigation

One location visible at a time. Location switching is a **pull-down
sheet** from the path bar (not a left sidebar — left edge is reserved
for back-gesture):

```
┌──────────────────────────────────────┐
│ ◁ PS5 SSD  / data / saves ▾     [⚙] │
├──────────────────────────────────────┤
│  ─── tap path bar to open switcher ──│
│  ▼ Switch location                   │
│    📁 PS5 SSD     ● 412 GB free      │
│    📁 PS5 USB0    ○ ejected          │
│    📁 SMB nas                          │
│    📁 Local                            │
│    ─────                              │
│    ★ Bookmarks   ⏱ Recent            │
└──────────────────────────────────────┘
```

### 13.2 Breadcrumbs + back gesture

- Path bar shows a condensed breadcrumb (`PS5 / data / saves`) that
  scrolls horizontally; tapping any segment jumps up.
- **Edge-swipe-right** = back (up one directory, or out of search/preview).
- **Pinch-out** on grid view = zoom out to parent (gallery-style).
- **Pinch-in** = zoom in.

### 13.3 File actions = bottom sheet

Single-tap a row → **bottom sheet** with actions (replaces desktop
right-click menu):

```
┌──────────────────────────────────┐
│  saves/CUSA00506/sdslot00.bin    │
│  4.1 MB · modified 2d ago        │
├──────────────────────────────────┤
│  👁 Preview                       │
│  ✂ Cut    ⧉ Copy                  │
│  ✎ Rename    🗑 Delete            │
│  ⤓ Download    📦 Download as zip │
│  # Checksum                       │
│  ★ Bookmark                       │
│  ⋮ More (chmod, restore, …)       │
└──────────────────────────────────┘
```

Drag-down to dismiss. Haptic on open.

### 13.4 Toolbar collapse

Mobile toolbar shows three primary actions inline
(`[↑ Upload] [⤓ Download] [⋮]`); `⋮` opens a bottom sheet with the
full toolbar (search, new folder, view mode, sort, multi-select toggle,
bookmark).

### 13.5 Selection bar (multi-select mode)

When multi-select is active, the bottom nav is replaced by a contextual
selection bar:

```
┌──────────────────────────────────────────┐
│ 3 selected              [Cut] [Copy] [⋮] │
└──────────────────────────────────────────┘
```

This is also where the **clipboard banner** (§11.3) docks — if items
are staged, the banner sits above this bar.

### 13.6 Mobile WebView hardening

Already in v4 (per v5-design §9.4): safe-area insets, `overscroll-behavior:
contain`, `touch-action: manipulation`, `-webkit-tap-highlight-color:
transparent`. Add: `overscroll-behavior-x: contain` on the breadcrumb
scroller to prevent horizontal swipe-back from firing mid-scroll.

---

## 14. Power-User Tools

The audit found 7 orphaned API endpoints with no UI. They do **not**
belong in the main browser (would clutter it), but must be reachable
from Files. Solution: a **Tools** section at the bottom of the location
sidebar.

```
─ Tools ────────────
🎯 Disk usage        ← opens the disk-usage VIEW for current PS5 volume
🔧 UFS fsck          ← repair tool (modal, dangerous-action confirm)
🗄 app.db query       ← raw SQL on /data/app.db (read-only by default)
📜 Syslog tail       ← kernel log as a special read-only file
🧩 Kernel modules    ← procModulesGet
🌐 Network interfaces← netInterfacesGet
🕐 Time / timezone   ← time/state get|set
```

### 14.1 Disk usage (🎯)

Just switches the current view to disk-usage mode (§5.4). Not a tool
per se — listed here as a shortcut for users who remember the old
standalone screen.

### 14.2 UFS fsck → Console → Tools (deep-link) [🔧]

> **R1 resolution (loops 81-90):** Cross-cutting §9.2 / C5 single-homes `ufsFsck` in **Console → Tools** (system-layer repair concern). File Browser does NOT render the modal itself — it offers a deep-link affordance. The earlier "three-escalation modal" UI has been removed from this section; see `v5-home-console-redesign.md` §11.5 (Tools) for the canonical modal spec.

Affordance shown in the toolbar of the **volumes view** (§5.3) and in the row-overflow menu of any volume row:

```
┌──────────────────────────────────────────────────────────┐
│  ⚠ Verify volume…  →                                     │
│  Opens Console → Tools → UFS fsck with:                  │
│    volume pre-selected = <current volume>                │
└──────────────────────────────────────────────────────────┘
```

- Button is gated by the same "no game running" telemetry condition as the Console → Tools modal — disabled with tooltip "Stop the running game first" when a game is active.
- The deep-link preserves the volume argument via query string: `/console?section=tools&tool=ufs-fsck&volume=ssd`.
- Returning to File Browser: the modal is a Sheet, so closing it returns focus to the originating File Browser row.

### 14.3 app.db query → Console → Tools (deep-link) [🗄]

> **R1 resolution (loops 81-90):** Same as §14.2 — `appdbQuery` is single-homed in Console → Tools. File Browser does NOT render the SQL console itself.

Affordance shown in the overflow menu of the **System** virtual folder (§14.4) and as a row-action on `app.db` if surfaced in a listing:

```
┌──────────────────────────────────────────────────────────┐
│  🗄 Query in app.db…  →                                  │
│  Opens Console → Tools → app.db with:                    │
│    filter pre-filled = <derived from current selection>  │
└──────────────────────────────────────────────────────────┘
```

- Pre-fill logic: if the user is on a per-game path (e.g. `/data/<title_id>`), the deep-link pre-fills `WHERE title_id = '<id>'`; otherwise blank.
- Deep-link: `/console?section=tools&tool=appdb&q=<urlencoded-filter>`.
- The canonical SQL console (Run / Export CSV / Allow-writes toggle) lives in `v5-home-console-redesign.md` §11.5.

### 14.4 Syslog tail (📜) + kernel modules (🧩) + network interfaces (🌐)

These three are presented as **special read-only filesystem views** —
they appear in the browser as virtual files:

- **Syslog** = a virtual file at the root of the PS5 location called
  `🐾 syslog` (or in a `System` virtual folder). Opens with the preview
  pane in **tail mode** (auto-scroll). Source: `/api/ps5/syslog/tail`.
- **Kernel modules** = a virtual folder `🐾 /proc/modules` listing each
  module as a row (name, size, refcount, state). Source: `procModulesGet`.
- **Network interfaces** = a virtual folder `🐾 /net/ifaces` listing
  interfaces with IP/MAC/MTU/status columns. Source: `netInterfacesGet`.

This reuses the browser's own list/preview UI rather than building three
new screens — the audit's "no UI" finding is closed by treating these
as virtual paths. A small `System` virtual location in the sidebar
groups them:

```
─ PS5 ───────
📁 SSD
📁 USB0
─ System ────
🐾 syslog
🐾 /proc/modules
🐾 /net/ifaces
```

### 14.5 Time / timezone (🕐)

A small modal launched from the Tools section. Uses `time/state/get|set`:

```
🕐 PS5 clock
Current: 2026-08-02 14:23:01 JST
Timezone: [Asia/Tokyo ▾]
NTP sync: ● On  ○ Off
[Sync now]  [Apply]
```

### 14.6 Checksum — first-class, not buried (closes gap #7 restated)

Already covered in §10.2 — checksum is in the selection-aware toolbar,
not in the Tools section. The Tools section just adds a shortcut
"Checksum a path…" that prompts for any path (Power-user convenience).

---

## 15. Data Flows & State

### 15.1 Store map (existing + new)

| Store | Status | Role in v5 browser |
|-------|--------|--------------------|
| `useFsClipboardStore` | exists | Extended: add `locationId` per item (§11.1) |
| `useFsBulkOpStore` | exists | Powers delete/move/copy/batch-rename banners |
| `useFsDownloadOpStore` | exists | Powers single + zip downloads |
| `useRecentPathsStore` | exists | Seeds the Recent section (§7) |
| `useFsNavStore` | exists | Cross-screen deep-links (Saves → Files, etc.) |
| `useBookmarksStore` | **new** | Like recentPaths, no cap, user-ordered, drag-reorder |
| `useLocationsStore` | **new** | Registry of FsLocation adapters + connection state |
| `useFsViewStore` | **new** | Per-location-path view mode + sort preferences |
| `usePreviewStore` | **new** | Current preview target, navigation index |
| `useMirrorJobsStore` | **new** | Persistent mirror job definitions (§11.4) |
| `useBatchRenameStore` | **new** | Ephemeral modal state (preview list) |
| `useSearchStore` | **new** | Search mode state (query, scope, filters, results) |

### 15.2 Selection persistence

Selection lives in `useFsViewStore[locationId][path]` — keyed by
**location + path**, not globally. Switching locations clears selection
with a confirm if non-empty. This prevents the classic "I selected 200
files in /saves then switched to /pkg and deleted" footgun.

### 15.3 Capability propagation

`useLocationsStore` exposes each location's `LocationCapabilities`. The
toolbar and context-menu builders are pure functions of
`(selection, capabilities, clipboardState)` — no special-casing.

### 15.4 Unified job routing

Per v5-design §6, all long-running ops route through the unified job
system:
- Bulk delete / move / copy → `fsBulkOp` (existing)
- Download (file / folder / zip) → `fsDownloadOp` (existing)
- Batch rename → new `fsBulkOp` kind `"rename"` (extend the union)
- Mirror job → new engine job kind `"mirror"` (v5-design §6.1)
- Archive download → existing `startTransferDownloadZip` job

All emit progress on `/api/events` SSE. The browser subscribes once.

---

## 16. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘U` | Upload |
| `⌘D` | Download (selection) |
| `⌘⇧D` | Bookmark current path |
| `⌘F` | Search mode |
| `⌘N` / `⌘⇧N` | New file / New folder |
| `⌘A` / `⌘⇧A` | Select all / Toggle multi-select |
| `⌘X` / `⌘C` / `⌘V` | Cut / Copy / Paste |
| `⌘⌫` | Delete |
| `↩` | Rename (or open if 1 selected) |
| `Space` | Preview (Quick-Look) |
| `⌘1`–`⌘4` | View mode: list / grid / tree / disk-usage |
| `⌘⇧S` | Sort dialog |
| `⌘\` | Toggle sidebar |
| `⌘⌥\` | Toggle context rail |
| `⌘⇧\` | Split window |
| `Esc` | Exit search / close preview / clear clipboard |
| `⌘↑` / `⌘↓` | Navigate parent / into selected folder |
| `←` `→` (in preview) | Previous / next file |

---

## 17. Migration & Backward-Compat

### 17.1 Screens removed

| v4 screen | v5 location |
|-----------|-------------|
| `FileSystem` (2715 LOC) | Files tab → PS5 location (rewritten, smaller) |
| `Search` (~400 LOC) | Files → search mode (§6) |
| `Volumes` (~150 LOC) | Files → sidebar entries (§3.1) |
| `DiskUsage` (~400 LOC) | Files → disk-usage view (§5.4) |
| `SmbBrowser` (~400 LOC) | Files → SMB location (§3.2) |
| `FtpServer` (~200 LOC) | Files → FTP location (§3.3) + Console toggle removed |

Net: ≈ 4265 LOC of v4 screens → one browser with richer behavior.

### 17.2 Route redirects

```
/file-system  → /files
/search       → /files?mode=search
/volumes      → /files
/disk-usage   → /files?view=disk-usage
/smb          → /files?loc=smb
/ftp          → /files?loc=ftp
```

### 17.3 Settings preserved

- Recent paths (existing localStorage key) → seeds Bookmarks defaults.
- Sort prefs per path → migrate to `useFsViewStore`.
- Last-used download dir → Local location default root.

### 17.4 API backward-compat

No engine changes required for the UI redesign except:
- New unified job kinds (`rename`, `mirror`) — additive, per v5-design §6.
- `startTransferDownloadZip` already supports arbitrary folders — no change.

---

## 18. Phased Implementation

> **Note (R5, loops 81-90):** The phase IDs below were originally `5.1-a`…
> `5.1-f` + `5.2`, which **collide** with the Game Hub's `5.1-a..f` and the
> canonical `5.2-a..e` in `v5-cross-cutting-concerns.md` §12. They are
> renumbered here to `5.1-l.1`…`5.1-l.6` (l = library/files) and the mirror
> work is folded into the canonical `5.2-f` slot. The **content** of each
> phase is unchanged; only the IDs are canonicalized. The cross-cutting §12
> ToC is the source of truth.

### Phase 5.1-l.1 — Browser shell (1.5 weeks)

1. `useLocationsStore` + PS5/Local adapters (reusing existing FS APIs)
2. New `FilesScreen` with sidebar (locations + bookmarks + recent)
3. Path bar + toolbar (always-available actions only)
4. List view only (port existing row rendering)
5. Wire existing `fsClipboard` + `fsBulkOp` + `fsDownloadOp` into the new shell

**Deliverable:** v5 Files tab replaces FileSystem at feature parity.

### Phase 5.1-l.2 — View modes + search (1 week)

6. Grid view with thumbnails (lazy)
7. Tree view (lazy expand)
8. Disk-usage view with delete-from-here (closes gap #8)
9. Search mode (closes the standalone Search screen)

### Phase 5.1-l.3 — Preview + bookmarks (1 week)

10. Context rail + preview renderers (image, JSON, SFO, hex, archive)
    (closes gap #2)
11. `useBookmarksStore` + sidebar sections + default seed (closes gap #3)

### Phase 5.1-l.4 — Batch ops + archive-out + checksum (1.5 weeks)

12. Batch rename modal (closes gap #4)
13. Batch chmod modal
14. Promote checksum to toolbar + folder-level + PS5↔local compare
    (closes gap #7)
15. "Download as ZIP" wired to `startTransferDownloadZip` for arbitrary
    folders (closes gap #6 — UI only, engine done)

### Phase 5.1-l.5 — Cross-location + mobile clipboard (1 week)

16. Extend `fsClipboard` with `locationId`; SMB + FTP adapters
17. Mobile clipboard banner + selection bar + bottom-sheet actions
    (closes gap #1)
18. Desktop drag-and-drop in/out

### Phase 5.1-l.6 — Integration points + tools (1 week)

19. `.pkg → install`, `.save → restore`, screenshot → Media chips (§12)
20. Tools section: fsck, app.db, syslog/modules/ifaces virtual files,
    time/timezone (closes all 7 orphaned-API gaps)

### Phase 5.2-f — Mirror jobs (0.5 weeks, depends on Tasks tab)

21. `mirror` engine job kind (Task System §1.1)
22. Mirror job modal + Tasks tab card (closes gap #5)

**Total: ≈ 7.5 weeks for a complete Files tab rewrite** that closes all
8 feature gaps and all 7 orphaned-API gaps, while reusing the existing
clipboard / bulk-op / download / recent-paths infrastructure.

---

## Appendix A — Cross-reference: audit gap → section

| # | Gap | Closed in |
|---|-----|-----------|
| 1 | Mobile drag-drop | §11.3, §13.5 |
| 2 | Preview / open-with | §8 |
| 3 | Bookmarks | §7 |
| 4 | Batch rename | §9.3 |
| 5 | Sync / mirror | §11.4, Phase 5.2 |
| 6 | Archive out (arbitrary folders) | §10.1 |
| 7 | Checksum folder-level + compare | §10.2 |
| 8 | Disk-Usage read-only | §5.4, §9.2 |

## Appendix B — Cross-reference: orphaned API → UI home

| API | UI home |
|-----|---------|
| `/api/ps5/syslog/tail` | §14.4 — virtual file `🐾 syslog` (tail mode) |
| `/api/ps5/time/state/get\|set` | §14.5 — Tools → Time |
| `netInterfacesGet` | §14.4 — virtual folder `🐾 /net/ifaces` |
| `procModulesGet` | §14.4 — virtual folder `🐾 /proc/modules` |
| `ufsFsck` | §14.2 — Tools → UFS fsck (3-tier confirm) |
| `appdbQuery` | §14.3 — Tools → app.db query console |
| `crc32File` + `fsBlake3Hash` | §10.2 — first-class toolbar action |

## Appendix C — What does NOT move into Files

To prevent the browser from becoming a junk drawer, these stay elsewhere
per v5-design:

- **Hardware / Processes / Fan Curve** → Console tab (it's "how is the
  PS5 doing", not "where are my files")
- **Cheats / Saves / SDK / Activity / TMDB** → Game Hub (game context)
- **Backup snapshots** → Console → Backup (system context)
- **Upload progress / install progress** → Tasks tab (unified timeline)

The browser's job is **moving files around and inspecting them**, not
running every system command. Tools (§14) is the escape hatch for the
orphaned system-level APIs, kept deliberately small.

---

*This document revises `v5-design.md` §3 (Files tab), §4-E (FTP+FS=SMB
unification), §9.3 (mobile file browser), and Appendix B rows for the 6
consolidated screens. Other sections of v5-design remain authoritative.*
