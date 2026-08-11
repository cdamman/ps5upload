# ps5upload v5.0 — Unified Task System (REVISED)

> **Status: historical.** This document is kept for the reasoning
> behind decisions that have since shipped. It describes intent at the
> time of writing, not current behaviour — check the code, `CHANGELOG.md`
> or `FAQ.md` before relying on anything here.

> **Supersedes** §6 "Unified Task System" of `docs/v5-design.md`.
>
> Grounded in the actual systems it replaces:
> - engine `JobState` enum (`engine/.../lib.rs:181`) — `Running | Done | Failed`, 200 ms ticker, 256-cap map, terminal-evicting
> - client `ActivityEntry` (`state/activityHistory.ts`) — durable 100-entry localStorage ring, `outcome: running|done|failed|stopped`
> - client `QueueItem` (`state/uploadQueue.ts`) — persisted Tauri JSON, `pending|running|done|failed`, per-host drain loops, `txIdHex` resume
> - client `AuditEntry` (`state/auditLog.ts`) — append-only 256-entry ring, destructive actions only
> - client `BulkOpState` / `DownloadOpState` (`state/fsBulkOp.ts`) — per-host async loops, op_id cancel
> - payload `bgft_install_status` (`payload/src/bgft.c`) — Sony install polling, synthetic 32-bit task-id space
> - client `Schedule` (`state/schedules.ts`) — `daily|weekly|once`, only fires while the app window is open
>
> Status: **PLANNING** — no code written yet.

---

## Table of Contents

0. [Design Principles for the Task System](#0-design-principles-for-the-task-system)
1. [Unified Job Model](#1-unified-job-model)
2. [Task Lifecycle](#2-task-lifecycle)
3. [Tasks Tab UI](#3-tasks-tab-ui)
4. [Retry Mechanism](#4-retry-mechanism)
5. [Task Chaining / Pipelines](#5-task-chaining--pipelines)
6. [Queue Management](#6-queue-management)
7. [Alert System](#7-alert-system)
8. [Telemetry Dashboard](#8-telemetry-dashboard)
9. [Statistics](#9-statistics)
10. [Disconnected / Recovery](#10-disconnected--recovery)
11. [History Consolidation](#11-history-consolidation)
12. [Automation](#12-automation)
13. [Multi-Console Task View](#13-multi-console-task-view)
14. [Gap-to-Section Cross-Reference](#14-gap-to-section-cross-reference)

---

## 0. Design Principles for the Task System

The v4 system already has **four** separate "is a thing happening?" surfaces: the engine `jobs` map (transient, 256-cap), client Activity (durable 100-cap), the upload queue (persisted, per-host), and AuditLog (append-only destructive). Each has a *legitimate* reason to exist — different retention, different permanence, different write-rate. **We do NOT merge the stores.** We merge the *navigation surface* and add a cross-reference so one task is findable everywhere.

Six principles drive every decision below:

1. **One id per unit of work.** Every observable task — upload, install, backup, cheat-download, pipeline — gets a stable `task_id` at creation, *and* carries the upstream `engine_job_id` / `op_id` / `bgft_task_id` as cross-references. Today `QueueItem.id`, `ActivityEntry.id`, and `engine JobId(Uuid)` are three uncorrelated keys; a task that flows through all three leaves no breadcrumb trail.
2. **Idempotent recovery.** Every task type defines *resume* semantics (skip-done, continue, restart) so recovery never re-does committed work. The engine already has `TX_FLAG_RESUME` + `txIdHex` for uploads; we extend the pattern.
3. **Queue owns scheduling, engine owns execution.** The engine is a thin async-execution surface that returns a job_id immediately and reports progress over SSE. Scheduling policy (priority, concurrency caps, dependencies, pause-one) lives in the client scheduler, which is the single place that decides what to start next.
4. **Never lose a task to eviction.** Engine `jobs` map caps at 256 and evicts terminal entries. Tasks that finish but haven't been *observed* by the durable store must not silently disappear — the client confirms durability before the engine record is allowed to age out (§2.5).
5. **History consolidates the *view*, not the *data*.** Activity (transient outcomes), AuditLog (destructive), Logs (diagnostic), and GameActivity (play-time) keep separate stores with their own retention. The History sub-view unifies them via filter + join on `task_id` / `ts` / `host` (§11).
6. **Rest-mode and disconnect are first-class, not error states.** A PS5 entering rest mid-upload is *expected* (the user put it there). The task pauses, the queue preserves, and a banner explains — never a silent failure.

---

## 1. Unified Job Model

### 1.1 The `Task` type

A single discriminated union covers every operation the user can observe. The discriminator is `kind`; common fields live on the outer envelope; per-kind specifics live in `payload`.

```ts
type TaskKind =
  // transfers (engine: jobs map + SSE)
  | "upload-file" | "upload-dir" | "upload-archive"   // .zip/.7z/.rar
  | "download"
  // filesystem ops (engine: op_id + op-status today → jobs in v5)
  | "fs-delete" | "fs-copy" | "fs-move" | "fs-rename"
  // mirror/sync (File Browser §15.4 — one-way replication tree)
  | "mirror"
  // installs (engine + payload bgft_install_status)
  | "pkg-install" | "pkg-dpi-install"
  // backups (engine: snapshot/restore → jobs in v5)
  | "backup-snapshot" | "backup-restore" | "save-backup" | "save-restore"
  // enrichment (lightweight client ops today)
  | "tmdb-fetch" | "cheat-download" | "icon-fetch"
  // library ops
  | "library-mount" | "library-register" | "library-unregister" | "library-launch"
  // pipelines (composite — see §5)
  | "pipeline";

interface Task {
  // ── identity ──────────────────────────────────────────────
  id: string;                 // ULID — stable across client+engine+history
  kind: TaskKind;
  /** Origin screen: where the user kicked this off. "files.upload" |
   *  "games.install" | "console.backup" | "pipeline.template:full-setup" |
   *  "schedule:nightly-backup" | "automation.on-launch". Drives the
   *  "Back to <screen>" link in the task row. */
  origin: string;
  /** Display label, refined as the task progresses (e.g. resolved title
   *  name once a pkg header is parsed). */
  label: string;
  /** Optional second line — typically From/To paths. */
  detail?: string;
  fromPath?: string;
  toPath?: string;

  // ── console scoping ───────────────────────────────────────
  /** Bare host (port-stripped) of the target console. Always set for
   *  PS5-touching tasks. Empty for pure-host tasks (very rare). */
  host: string;
  /** Transfer-port addr `ip:9113` (legacy field, kept so existing API
   *  call sites don't churn). */
  addr?: string;

  // ── lifecycle ─────────────────────────────────────────────
  status: TaskStatus;         // §2
  createdAt: number;          // ULID-embedded, but explicit for queries
  startedAt?: number;
  completedAt?: number | null;
  /** Why it ended this way, if terminal. Human string + machine reason. */
  error?: string;
  errorReason?: string;       // payload error_category (e.g. direct_writer_io_error)
  errorDetail?: string;       // payload "detail" field

  // ── progress (live for running, final for done) ───────────
  bytesSent?: number;
  totalBytes?: number;
  filesSent?: number;
  totalFiles?: number;
  /** Smoothed bytes/sec (trailing 2 s window). 0 when not running. */
  bytesPerSec?: number;
  /** Wall-clock ETA in seconds, derived from rate + remaining. */
  etaSec?: number;
  /** Reconcile skips (dir uploads). */
  skippedFiles?: number;
  skippedBytes?: number;
  /** Post-100% commit-apply counters (engine P3 / v2.18.0 APPLY_PROGRESS). */
  filesFinalized?: number;
  filesFinalizingTotal?: number;

  // ── retry / recovery ──────────────────────────────────────
  attempt: number;            // 1-based; 0 never started
  maxAttempts: number;        // default 3, configurable per-kind + per-task
  recovering?: boolean;       // mid-backoff between auto-retry attempts
  recoverAttempt?: number;

  // ── dependencies / pipeline ───────────────────────────────
  /** task_ids that must reach `done` before this one starts. Empty for
   *  standalone. Set by pipelines (§5). */
  dependsOn: string[];
  /** For pipeline tasks: which step index this is. */
  pipelineStep?: number;
  pipelineId?: string;

  // ── queue / scheduling ────────────────────────────────────
  priority: number;           // 0 = highest. Default 100.
  /** "ready" | "blocked" | "queued" | "running" | "held". The scheduler
   *  sub-state distinct from lifecycle `status` — a `pending` task can
   *  be `blocked` (deps unsatisfied) or `held` (user paused). */
  queueState: QueueState;

  // ── cross-references (the new bit) ────────────────────────
  /** The engine job_id once the engine has accepted the task. Null until
   *  the scheduler hands the task to the engine. Multiple over the
   *  task's life (retries mint new engine job_ids); we keep the latest
   *  and a count of historical ones in `priorJobIds`. */
  engineJobId?: string;
  priorJobIds?: string[];
  /** Payload op_id for FS ops (today's op-status system). */
  opId?: number;
  /** Sony BGFT task id for pkg installs (synthetic 32-bit, see bgft.c). */
  bgftTaskId?: number;
  /** Durable Activity entry id (so the History view can join). */
  activityId?: string;
  /** AuditLog entry ids if this task performed destructive actions. */
  auditIds?: string[];

  // ── resume continuity ─────────────────────────────────────
  /** Stable tx id for upload resume across app restart. Already exists
   *  on QueueItem.txIdHex — promoted to the unified Task. */
  txIdHex?: string;

  // ── per-kind payload ──────────────────────────────────────
  payload: TaskPayload;
}
```

### 1.2 `TaskStatus` (lifecycle)

```ts
type TaskStatus =
  | "pending"      // created, not yet eligible to run (deps/queue/hold)
  | "running"      // handed to the engine, progress flowing
  | "paused"       // user-paused OR console-disconnected; will resume
  | "done"         // terminal success
  | "failed"       // terminal failure (attempts exhausted)
  | "cancelled";   // user explicitly cancelled
```

`paused` is the **new** state — v4 has no concept of "intentionally suspended, will pick up later". Today an upload that hits a wifi drop either auto-recovers (transient `recovering` flag inside `running`) or fails. Rest-mode (§10) and queue-pause-one (§6) both need a stable `paused` that survives app restart.

### 1.3 `QueueState` (scheduler sub-state)

```ts
type QueueState =
  | "ready"     // deps satisfied, waiting for a concurrency slot
  | "blocked"   // deps unmet — won't run until upstream tasks `done`
  | "queued"    // admitted to the runnable set; scheduler will pick it
  | "running"   // same as status === "running"; duplicated for fast filtering
  | "held";     // user paused; stays even if deps would let it run
```

### 1.4 Per-kind `TaskPayload`

```ts
type TaskPayload =
  | UploadPayload         // file | dir | archive (.zip/.7z/.rar)
  | DownloadPayload
  | FsOpPayload           // delete | copy | move
  | PkgInstallPayload
  | BackupPayload         // snapshot | restore
  | SaveBackupPayload
  | EnrichmentPayload     // tmdb | cheats | icon
  | LibraryOpPayload
  | PipelinePayload;

interface UploadPayload {
  sourceKind: "file" | "folder" | "game-folder" | "archive" | "image" | "pkg";
  sourcePath: string;
  resolvedDest: string;
  strategy: "fresh" | "resume";
  reconcileMode?: "fast" | "size" | "hash";
  excludes: string[];
  archiveFormat?: "zip" | "7z" | "rar";
  /** Redacted from persistence (mirrors QueueItem.rarPassword). */
  rarPassword?: string | null;
  bandwidthCapMbps?: number;
  mountAfterUpload?: boolean;
  mountReadOnly?: boolean;
  registerAfterUpload?: boolean;
  // pkg-as-upload: chained install
  installAfterUpload?: boolean;
  deletePkgAfterInstall?: boolean;
  contentId?: string | null;
  category?: "gd" | "gp" | "ac" | null;
  /** Surfaced by the engine on the first Running tick. */
  plannedFiles?: { rel_path: string; size: number }[];
}

interface FsOpPayload {
  op: "delete" | "copy" | "move";
  paths: string[];
  dest?: string;
}

interface PkgInstallPayload {
  stagedPath: string;
  contentId?: string | null;
  category?: "gd" | "gp" | "ac" | null;
  viaDpi: boolean;
  deleteStagedAfterInstall: boolean;
  /** Surfaced by the install-progress poller. */
  installedBytes?: number;
  installPhase?: "downloading" | "installing" | "done" | "warn" | "error";
  mayNotLaunch?: boolean;
}

interface BackupPayload {
  tag: string;
  scope: "full" | "saves-only" | "trophies-only" | "selected-games";
  selectedTitleIds?: string[];
  destDir: string;
}

interface EnrichmentPayload {
  enrich: "tmdb" | "cheats" | "icon" | "all";
  titleId: string;
  engine?: "goldhen" | "etahen";
}

interface PipelinePayload {
  templateId: string;          // "full-setup" | "nightly-backup" | custom
  titleId?: string;            // for per-game pipelines
  stepIds: string[];           // ordered task_ids — the pipeline's children
  onStepFail: "halt" | "continue" | "halt-after-critical";
}

interface LibraryOpPayload {
  op: "mount" | "register" | "unregister" | "launch";
  path?: string;
  titleId?: string;
}
```

### 1.5 The four cross-reference keys, in one place

| Surface | v4 key | v5 cross-ref field on `Task` |
|---------|--------|------------------------------|
| Engine `jobs` map | `JobId(Uuid)` | `engineJobId` (+ `priorJobIds[]`) |
| Payload FS op | 64-bit `op_id` | `opId` |
| Payload BGFT install | synthetic 32-bit `task_id` | `bgftTaskId` |
| Client Activity store | `${ts36}-${counter36}` | `activityId` |
| Client AuditLog | `crypto.randomUUID()` | `auditIds[]` |
| Engine transfer tx | `tx_id_hex` (32-char) | `txIdHex` |

**Migration rule:** every existing call site that creates one of these records must, after creating it, `task.link(ref)` so the cross-ref lands on the Task envelope. This is a thin adapter layer, not a rewrite — the stores themselves are untouched.

---

## 2. Task Lifecycle

### 2.1 State machine

```
                              ┌──────────────┐
                              │   created    │  (task in store, status=pending,
                              │              │   queueState=blocked|ready)
                              └──────┬───────┘
                                     │ scheduler admits (deps satisfied + slot free)
                                     ▼
                              ┌──────────────┐
                  ┌───────────>│   running    │◀────────────┐
                  │            │              │             │
                  │            └──┬─────┬─────┘             │
                  │   user pause │     │ terminal event     │ auto-retry
                  │   OR console │     │ (done|failed)      │ within attempt budget
                  │   disconnect │     │                    │
                  │             ▼     ▼                     │
                  │      ┌─────────┐  ┌─────────┐  ┌────────┴────┐
                  │      │ paused  │  │  done   │  │   failed    │
                  │      │         │  │ (final) │  │ (attempt <  │
                  │      └────┬────┘  └─────────┘  │  max → retry│
                  │           │                    │  else final)│
                  │  resume   │                    └─────────────┘
                  └───────────┘
                                ┌──────────┐
                                │cancelled │  (user action, any non-terminal state)
                                └──────────┘
```

### 2.2 Transitions and who fires them

| From | To | Fired by | Side effects |
|------|----|----------|--------------|
| (created) | pending | task `create()` | write to durable store; emit `task:created` SSE |
| pending | running | scheduler | hand to engine; record `engineJobId`; create Activity entry (`activityId`) |
| running | running | engine ticker (200 ms) | patch progress fields; debounce-persist every 500 ms |
| running | paused | user `pause()` OR disconnect watcher | `engineJobId` cancel requested (cooperative, leaves resumable shards); emit `task:paused` |
| paused | running | user `resume()` OR reconnect | new engine job minted (prior id → `priorJobIds`); resume via `txIdHex` |
| running | done | engine `JobState::Done` | record final bytes; audit if destructive; emit `task:done` |
| running | failed | engine `JobState::Failed` | record `errorReason`; if `attempt < maxAttempts` AND recoverable → bump attempt, schedule retry; else terminal |
| running / paused | cancelled | user `cancel()` | engine cancel (if running); never resumable; audit if destructive had already happened |
| failed (auto-retry budget left) | pending | retry scheduler | `attempt++`; backoff (exponential, capped); queueState → ready |

### 2.3 What's recoverable, per kind

This is the table that makes "retry doesn't start from scratch" real.

| Kind | Recoverable mid-task? | Resume mechanism |
|------|----------------------|------------------|
| `upload-file` | **Yes** | `txIdHex` + `TX_FLAG_RESUME` — payload's last-acked shard is the resume point. Already works for queue items. |
| `upload-dir` | **Yes** | Reconcile-mode resume: payload's journal has committed files; only unfinished ones (incl. the one mid-flight) re-send. Idempotent. |
| `upload-archive` (.zip/.7z) | **Partial** | Host-side re-extract; only un-acked shards re-sent. LZMA2 (.7z) can't seek → re-decompress from start, but network transfer resumes. |
| `upload-archive` (.rar) | **Partial** | Same as .zip; password re-prompted if `rarPassword` redacted (lost on restart). |
| `download` | **Yes** | `.part` file promotion is server-side; client retries idempotently. |
| `fs-delete` | **No** (already freed) | Restart reports "X deleted, Y remaining" — no work redone. |
| `fs-copy` / `fs-move` | **Yes** | Payload `cp_rf` is restartable per-file; reconcile skips done files. |
| `fs-rename` | **Yes** (idempotent) | Atomic per-entry; retry reports "already renamed" for done entries. See File Browser §11.4 (bulk-rename batch op). |
| `mirror` | **Yes** (idempotent) | Tree reconciliation: size/mtime/CRC comparison skips files already mirrored; only deltas transfer. See File Browser §15.4 (Mirror view). |
| `pkg-install` | **Restart** | Sony install state is opaque; we re-poll `bgft_install_status`. If the staged pkg is intact, install resumes from Sony's internal progress; if not, restart from the staged file (no re-upload). |
| `pkg-dpi-install` | **Restart from staged** | DPI is HTTP-source; on retry we re-download from URL unless the staged file exists. |
| `backup-snapshot` | **Continue** | Snapshot is per-section (saves / trophies / settings); partial snapshot taggable as "incomplete". Retry continues from next section. |
| `backup-restore` | **Restart section** | Restore is destructive; retry re-applies the current section from the start (safer than half-applied). |
| `save-backup` | **Per-slot continue** | Each save slot is independent; failed slots retry, done slots skip. |
| `cheat-download` | **Restart** (idempotent) | Re-download overwrites; no harm. |
| `tmdb-fetch` | **Restart** | HTTP GET; idempotent. |
| `pipeline` | **Per-step** | Pipeline retries only the failed step; upstream `done` steps never re-run. |

### 2.4 Auto-retry policy

- **Default budget:** `maxAttempts = 3` (1 initial + 2 retries). Configurable globally (Settings → Tasks) and per-task (Advanced in the task's row menu).
- **Recoverable error classes** (mirror v4's `isAutoRecoverable`, extended):
  - Connection-class: payload unreachable, transfer-port timeout, mgmt-port still alive
  - PS5-side transient: `direct_writer_io_error` with EAGAIN, OOM-kill of payload
  - Rest-mode / reboot mid-task (§10) — *always* recoverable if the console comes back within 10 min
- **Non-recoverable** (fail immediately, no retry):
  - Out of space (`fs_write_failed_errno_28`, `direct_writer_io_error` on ENOSPC)
  - Path rejected (`fs_delete_path_not_allowed`, sandbox violation)
  - Source missing (local file deleted, source pkg gone)
  - Auth/drm reject on install
- **Backoff:** exponential, 2 s → 5 s → 15 s → 30 s, capped at 30 s. Jittered ±20%. Interruptible by Stop.
- **Surfacing:** while in backoff, the row shows "Recovering (2/3)…" with the countdown; the underlying error text is preserved as a secondary line. This mirrors v4's `recovering` / `recoverAttempt` fields exactly.

### 2.5 The eviction-safety handoff (new)

Engine `jobs` map caps at 256 and evicts terminal entries on insert. v4 has no guarantee that a finished engine job has been observed by the durable Activity store before eviction. v5 adds a **durability ack**:

1. Engine completes a job → emits `job:done` SSE with the final snapshot.
2. Client receives it, writes the Activity entry, then POSTs `/api/jobs/:id/ack`.
3. Engine marks that job "acked" — acked entries are evicted *first* (LRU among acked), so unacked terminal jobs survive longest.
4. If the engine's acked-queue itself is full, the *oldest unacked* is force-evicted with a `job:evicted_unacked` event the client uses to mark its Activity entry "engine record lost" (the Activity entry itself is untouched).

This closes the "engine forgot, client never saw" gap without raising the cap.

---

## 3. Tasks Tab UI

### 3.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Tasks                                                               │
│                                                                     │
│ [Console: PS5 Pro ▾] [All types ▾] [Filter]    [New pipeline ▾]    │
│                                                                     │
│ ─── Active (3) ─ Recent (12) ─ History ─ Statistics ─ Telemetry ──  │
│                                                                     │
│ ╭─────────────────────────────────────────────────────────────────╮ │
│ │ ▶ Installing Astro's Playroom.pkg              step 2/4 of       │ │
│ │   ████████████░░░░░░░░  2.1 / 3.2 GiB   14 MiB/s   ETA 1m 12s   │ │
│ │   pipeline "Full setup"                  [⏸ Pause] [✕ Cancel]   │ │
│ ╰─────────────────────────────────────────────────────────────────╯ │
│ ╭─────────────────────────────────────────────────────────────────╮ │
│ │ ⟳ Upload /data/ps5/Rogue.pkg   recovering (2/3)… 18s             │ │
│ │   ██████████████████░░  18 / 30 GiB    [⏸ Pause] [✕ Cancel]     │ │
│ ╰─────────────────────────────────────────────────────────────────╯ │
│                                                                     │
│ Up next ──────────────────────────────────────────────────────────  │
│ ╭ queued ─ Fetch TMDB art for CUSA00506   [▶ Run now] [✕]  ready  ╮ │
│ ╭ blocked ─ Download cheats               waiting on: TMDB fetch   ╮ │
│                                                                     │
│ Recently finished ────────────────────────────────────────────────  │
│ ✓ Upload complete: /data/themes/dark.css              2 min ago     │
│ ✓ Backup snapshot "pre-FW12"               18 min ago  [Restore]    │
│ ⚠ Install rejected: Rogue.pkg (DRM)        1 h ago     [Retry ▾]    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Sub-views

| Sub-view | What it shows | Source |
|----------|--------------|--------|
| **Active** | Tasks with `status: running\|paused` and `queueState: queued\|running\|blocked\|held` for the selected console(s). Live-updating progress bars, speed, ETA. Includes "Up next" section showing the next 3 ready/blocked tasks. | tasks store (live) + SSE |
| **Recent** | Tasks that reached a terminal state in the last 24 h. Collapsible rows. Action buttons depend on outcome: `Retry` (failed), `Restore` (backup-done), `Open Game Hub` (install-done), `View skipped files` (upload with `skippedFiles > 0`). | tasks store (terminal, last 24 h) |
| **History** | Full searchable/filterable unified history. Filters: kind, outcome, console, date range, pipeline, error reason. Joins Activity + Audit + GameActivity (§11). Bug Report is an action here, not a destination. | unified view over 4 stores (§11) |
| **Statistics** | Aggregated metrics + trends (§9). | materialized from History |
| **Telemetry** | Live + historical graphs (§8). | telemetry ring buffer (new) |

### 3.3 Row anatomy

Every row, regardless of sub-view, renders the same skeleton:

```
╭─ <status icon> <label>                                  <relative time> ─╮
│   <detail line: from → to, or step N of M pipeline>                      │
│   <progress bar OR final summary>      <speed/eta OR final counters>     │
│   <error/warning/skip secondary line if present>                         │
│                                                          <action buttons>│
╰──────────────────────────────────────────────────────────────────────────╯
```

- **Status icon:** ▶ running, ⟳ recovering, ⏸ paused, ✓ done, ⚠ failed, ⊘ cancelled, ⛔ blocked.
- **Action buttons** (right-aligned, only the relevant ones):
  - Running: `[⏸ Pause] [✕ Cancel]` + kebab `⋮` → `Lower priority`, `Raise priority`, `View dependencies`, `Open origin screen`.
  - Paused: `[▶ Resume] [✕ Cancel]`.
  - Recovering: `[✕ Give up]` (cancels the retry budget).
  - Failed: `[Retry ▾]` (dropdown: `Retry from where it stopped`, `Retry from scratch`, `Retry as new task`) + `[Dismiss]`.
  - Done-upload: `[Open in Files]`.
  - Done-install: `[Open Game Hub]`.
  - Done-backup: `[Restore…]`.
  - Any with `skippedFiles > 0`: `[View N skipped…]` (opens the skip-detail drawer, §7-of-the-gaps / partial-failure surfacing).
  - Any: kebab `⋮` → `Copy as command`, `Add to pipeline`, `Schedule repeat…`, `Bug report from this task`.

### 3.4 "Returning user" landing

Per the workflow-trace finding ("returning user lands on changelog"), the app opens to:
- **Tasks → Active** if any tasks are running or paused (most likely thing they care about).
- **Home → Dashboard** otherwise.

The Changelog opens automatically only on first launch after an upgrade, then never again until the next upgrade. It is reachable from the Drawer → "What's New".

### 3.5 ⌘K jump to task (resolves C12 / R3)

The global Command Palette (see `v5-cross-cutting-concerns.md` §4.5) supports deep-linking into a specific task's row:

- Syntax: `#<task-id>` or natural-language "task <id>" / "go to task <id>".
- Partial ID match: typing `#01J…` surfaces matching ULIDs as a typeahead list.
- Result action: navigate to `/?tab=tasks&task=<id>` (Tasks tab opens with the row scrolled into view and briefly highlighted — the standard "target row" treatment used by every deep-link).
- Available when: the palette is open (anywhere in the app). The Tasks tab need not be active.
- Discovery: the Tasks tab header shows a hint chip "⌘K then #id to jump" on first visit; dismissible.

---

## 4. Retry Mechanism

### 4.1 The three retry modes

Every failed task offers up to three retry flavors (whichever apply):

1. **Resume** — pick up from the last durable point. Default for uploads, downloads, fs-copy/move, backups, save-backup.
2. **Restart from scratch** — discard partial state, re-do everything. Offered for cheat-download, tmdb-fetch, library ops, and (when the staged pkg is gone) pkg-install.
3. **Retry as new task** — clone the task config into a fresh `pending` task; the original stays in History as failed. For when the user wants to change settings first.

### 4.2 Per-kind defaults

| Kind | Default retry mode | Configurable? |
|------|-------------------|---------------|
| `upload-file/dir/archive` | Resume (`TX_FLAG_RESUME` + `txIdHex`) | Yes — Advanced → "Restart" |
| `download` | Resume (server-side `.part`) | No (Resume is always safe) |
| `fs-copy` / `fs-move` | Resume (reconcile) | Yes |
| `fs-delete` | Restart (no-op for done files) | N/A — effectively free |
| `pkg-install` | Restart from staged file (if present) else "Retry as new" (re-upload + install) | Yes |
| `pkg-dpi-install` | Restart from URL | Yes |
| `backup-snapshot` | Continue (next section) | Yes — "Restart from scratch" |
| `backup-restore` | Restart current section | Yes |
| `save-backup` | Continue (per-slot) | Yes |
| `cheat-download` / `tmdb-fetch` / `icon-fetch` | Restart (idempotent) | No |
| `pipeline` | Retry failed step only (default) | Yes — "Retry from step N", "Retry whole pipeline" |

### 4.3 Configurable retry count

- **Global default:** Settings → Tasks → "Max attempts per task" (default 3).
- **Per-kind override:** Settings → Tasks → per-kind table (advanced users).
- **Per-task override:** task row kebab → "Set retry budget…" (one-off).
- **Per-pipeline-step:** pipeline editor → step → "Max attempts" (e.g. retry cheat-download 5× because repos are flaky, but only try install once).

### 4.4 The 30 GB upload case (the headline gap)

Today: a failed 30 GB upload at 28 GB restarts from 0. In v5:
1. Upload fails at 28 / 30 GB with `direct_writer_io_error` (wifi blip).
2. Auto-recovery kicks in (recoverable class). Row shows "Recovering (1/3)… 2s".
3. Payload re-deployed if needed; `txIdHex` re-submitted with `TX_FLAG_RESUME`.
4. Engine reads payload journal → last-acked shard is at 28 GB. Resume sends the final 2 GB.
5. If auto-recovery exhausts its budget, the row flips to `failed` with the Retry dropdown. "Retry from where it stopped" is the highlighted default.
6. If the user closed the app between failure and retry, the persisted Task carries `txIdHex`; on next launch the Active sub-view shows "Paused — resume available" and the user can resume across an app restart (new in v5 — v4's `txIdHex` is only consulted when the queue is running).

### 4.5 Retry budget across app restarts

`attempt` and `maxAttempts` are persisted on the Task. A task that used 2 of 3 attempts, then the app was closed, then reopened → still has 1 retry left. The user can always "Reset retry budget" from the kebab to restore the full budget.

---

## 5. Task Chaining / Pipelines

### 5.1 What a pipeline is

A pipeline is itself a `Task` with `kind: "pipeline"` whose `payload: PipelinePayload` references child task_ids. The children are ordinary Tasks with `dependsOn` edges forming a DAG. The pipeline Task's `status` mirrors the aggregate state of its children:

- `running` while any child is running or runnable
- `done` when all children `done`
- `failed` if any child terminally `failed` AND `onStepFail === "halt"`
- `paused` if all not-done children are `held`

### 5.2 The canonical pipeline: per-game "Full setup"

This is the workflow the audit explicitly names — "after upload → install → fetch TMDB → download cheats":

```
upload(pkg) ──▶ install ──▶ fetch-tmdb ──┬─▶ download-cheats
                                          └─▶ fetch-icon
```

Encoded as four child Tasks + one pipeline Task:

| Step | kind | dependsOn | payload |
|------|------|-----------|---------|
| 1 | `upload-file` (sourceKind=pkg) | — | `resolvedDest=/data/pkg/staging/Rogue.pkg`, `installAfterUpload=false` (the pipeline owns the install step explicitly, so we don't double-install) |
| 2 | `pkg-install` | [step1] | `stagedPath=/data/pkg/staging/Rogue.pkg`, `deleteStagedAfterInstall=true` |
| 3 | `tmdb-fetch` | [step2] | `titleId=CUSA00506` |
| 4a | `cheat-download` | [step3] | `titleId=CUSA00506` (parallel with 4b) |
| 4b | `icon-fetch` | [step3] | `titleId=CUSA00506` |

### 5.3 Three ways to create a pipeline

#### A. Preset templates (the 90% case)

A built-in library of templates, selectable from "New pipeline ▾":

| Template id | Steps | When to use |
|-------------|-------|-------------|
| `full-setup` | upload → install → tmdb → cheats+icon | "I have a new game's .pkg and want it fully set up" |
| `install-and-enrich` | install → tmdb → cheats | "pkg is already on the PS5" |
| `backup-game` | save-backup → tmdb-fetch (refresh art) | "back up this game's saves" |
| `nightly-backup` | backup-snapshot (saves-only) | "schedule nightly at 03:00" (§12) |
| `reinstall` | unregister → delete-old → upload → install | "clean reinstall over a broken install" |

Templates are plain JSON in `client/src/pipelines/*.json`; users can import/export share them.

#### B. Visual editor (the power-user case)

"New pipeline ▾ → Custom…" opens a node editor:

```
┌──────────────────────────────────────────────────────────────────┐
│ Pipeline editor                              [Save] [Run now]    │
│                                                                  │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌────────┐ │
│   │ Upload   │────▶│ Install  │────▶│ TMDB     │──┬─▶│ Cheats │ │
│   │ .pkg     │     │          │     │ fetch    │  │  └────────┘ │
│   └──────────┘     └──────────┘     └──────────┘  │             │
│                                                   └─▶┌────────┐ │
│                                                      │ Icon   │ │
│                                                      └────────┘ │
│                                                                  │
│ On step failure:  (•) Halt   ( ) Continue   ( ) Halt if critical│
│ Max attempts per step:  [ 3 ▾ ]                                 │
└──────────────────────────────────────────────────────────────────┘
```

- Drag from a palette of task kinds onto a canvas.
- Connect outputs to inputs to set `dependsOn`.
- Click a node to edit its payload (same form as the standalone screen for that kind).
- Parallel branches fan out from a node; the join is implicit (downstream waits for all upstream).
- Save → prompts for name → becomes a user template (appears in "New pipeline ▾").

#### C. From an existing task ("do the next thing")

Any done task's kebab has "Add next step…". Choosing e.g. "Install" after a done upload creates a 2-step pipeline retroactively. This is how ad-hoc chaining happens without planning.

### 5.4 Pipeline execution semantics

- **Scheduler-aware:** pipeline children are ordinary tasks; the scheduler runs as many as are ready subject to the global/per-console concurrency caps (§6). A pipeline with 4 steps doesn't get to hog 4 slots unless the caps allow.
- **Failure handling** per `onStepFail`:
  - `halt` — first downstream step that would have depended on the failed step goes `cancelled`; siblings continue; pipeline `failed`.
  - `continue` — downstream steps still run; if they need the failed step's output they'll fail too, independently.
  - `halt-after-critical` — steps marked `critical: true` halt the pipeline; non-critical failures continue.
- **Retry** — the pipeline Task's kebab offers "Retry failed step", "Retry from step N", "Retry whole pipeline (skips done steps)".
- **Observability** — pipeline Tasks render as an expandable row showing the step strip (the §3.1 mockup's "step 2/4 of pipeline" indicator). Clicking the strip scrolls to that child task in the Active list.

### 5.5 Per-game "Full setup" one-click

On the Games tab, each not-installed game with a local `.pkg` shows a **"Full setup"** button. Click → instantiates the `full-setup` template bound to that title_id + that pkg path. The pipeline appears in Active; the user can watch it progress or navigate away.

This is the single highest-leverage workflow in the redesign.

---

## 6. Queue Management

### 6.1 The scheduler (single source of truth)

A single client-side scheduler replaces the implicit per-host drain loops in `uploadQueue.ts`. It owns:

- The set of tasks with `status: pending` and `queueState: ready|queued`.
- Per-console concurrency caps.
- Priority ordering.
- The decision "what to start next".

**Picking the next task** (per console):

```
1. Filter: queueState === "ready" AND host === thisConsole
2. Sort by: priority ASC, then createdAt ASC (stable FIFO within a priority)
3. If runningCount(thisConsole) < cap(thisConsole): admit the head
4. Hand to engine; record engineJobId; flip queueState → running
```

### 6.2 Concurrency limits

- **Global default:** 1 concurrent task per console (matches v4's per-host serial drain, which exists because the payload's mgmt-port threads choke on burst).
- **Per-kind override:** e.g. "Allow 3 concurrent `cheat-download`" (lightweight HTTP), "Only 1 `pkg-install` at a time" (Sony's installer is single-threaded).
- **Per-console override:** Settings → Consoles → this PS5 → "Max concurrent tasks".
- **Per-pipeline override:** a pipeline can declare it needs exclusive access (e.g. a backup pipeline that touches the same files as uploads).

The cap is enforced by the scheduler; a task whose slot isn't free stays `ready` and renders in "Up next".

### 6.3 Priority

- Tasks have `priority: number` (lower runs first). Default `100`.
- **Install-order priority is preserved** — the v4 `installOrderPriority` rule (base `gd` → 0, update `gp` → 1, DLC `ac` → 2) becomes a default priority assigned at task creation for pkg kinds. Manual priority overrides it.
- **Raise / lower** from the row kebab or by drag-handle in the "Up next" list.
- **Starve protection:** a task that's been `ready` for > 10 min gets its priority auto-decremented by 1 every minute (aging), so a flood of high-priority new tasks can't permanently block an old one.

### 6.4 Pause / resume individual tasks

- **Pause** (`running` → `paused`): the row's ⏸ button. Engine cancel requested *cooperatively* — at the next shard boundary for uploads (partial tx stays resumable), at the next directory entry for fs-ops, immediately for installs (Sony's installer suspends cleanly).
- **Resume** (`paused` → `running`): ⏵ button. Mints a new engine job; `txIdHex` makes it resume.
- **Hold** (`ready`/`queued` → `held`): same button, different starting state. The task won't be admitted even when a slot opens.
- **Pause-one-to-let-another-run** is now trivial: pause the running task (freeing its slot) → the scheduler admits the next ready task. No need to cancel.

### 6.5 Reorder

- Drag-and-drop in "Up next" reorders within a priority band.
- Right-click → "Send to top" / "Send to bottom".
- Keyboard: select row → ⌥↑ / ⌥↓.

### 6.6 Bulk queue operations

- "Pause all on this console", "Resume all", "Cancel all failed".
- "Clear completed" (recent only, never active).
- Multi-select via ⌘-click → bulk priority, bulk pause, bulk cancel.

### 6.7 Queue persistence

- The scheduler state (all `pending` / `paused` tasks + their `dependsOn`) is persisted to the same Tauri JSON document as today's `upload_queue.json`, generalized to `tasks.json`.
- On hydrate: any task with `status: running` is reset to `pending` (the engine doesn't remember it after restart) — same hygiene as v4.
- `paused` tasks stay paused across restart (new — the user explicitly wanted them held).

---

## 7. Alert System

### 7.1 What an alert is

An alert is a **threshold rule evaluated against the telemetry stream** that, when crossed, fires a notification + is logged to the AlertLog. Distinct from:
- **Notifications** (info-level event surface, existing) — alerts *push into* notifications.
- **AuditLog** (destructive actions) — alerts are observability, not user actions.

### 7.2 Rule definition

```ts
interface AlertRule {
  id: string;
  enabled: boolean;
  /** Metric path in the telemetry snapshot, e.g. "temps.cpu", "fan.duty",
   *  "power.draw", "storage.internal.free_gb". */
  metric: string;
  /** Comparison: the rule fires when `metric OP value` holds. */
  op: ">" | "<" | ">=" | "<=" | "==";
  value: number;
  /** How long the condition must hold continuously before firing
   *  (debounce against spikes). Default 10 s. */
  sustainedSec: number;
  /** Re-arm: don't fire again until the metric has been inside bounds
   *  for this long. Default 60 s. */
  cooldownSec: number;
  severity: "info" | "warn" | "critical";
  /** What to do on fire. */
  actions: AlertAction[];
  /** Console scope: host, or "*" for all. */
  host: string | "*";
}

type AlertAction =
  | { kind: "notify"; message: string }
  | { kind: "pause-console"; host: string; reason: string }   // auto-pause all tasks on a console
  | { kind: "play-sound"; sound: "chime" | "alert" | "error" }
  | { kind: "run-task"; taskTemplateId: string };             // e.g. trigger a backup
```

### 7.3 Default rules (ship out of the box)

| Rule | Metric | Threshold | Severity | Default action |
|------|--------|-----------|----------|----------------|
| CPU overheat | `temps.cpu` | `> 85` for 10 s | critical | notify + pause-console |
| SoC overheat | `temps.soc` | `> 85` for 10 s | critical | notify + pause-console |
| Fan maxed | `fan.duty` | `>= 100` for 30 s | warn | notify |
| Power spike | `power.draw` | `> 250` for 5 s | warn | notify |
| Storage low | `storage.internal.free_gb` | `< 20` | warn | notify |
| Storage critical | `storage.internal.free_gb` | `< 5` | critical | notify + pause uploads |

Users edit these in Console → Alerts (or Settings → Alerts for cross-console).

### 7.4 Where alerts are shown

- **Status bar** (bottom of every screen): a bell icon with a count badge. Red dot if any critical is active.
- **Notification center** (existing): alerts flow in as notifications with `severity` styling.
- **Telemetry dashboard** (§8): alert events are vertical-line overlays on the time-series graphs — hover shows the rule that fired and the metric value at that instant.
- **History → Alerts tab**: the historical alert log (§7.5).
- **Toast**: critical alerts toast immediately and persist until dismissed.

### 7.5 Historical alert log

A new store (mirrors AuditLog's shape, separate retention):

```ts
interface AlertEvent {
  id: string;
  ts: number;
  ruleId: string;
  ruleLabel: string;
  host: string;
  metric: string;
  value: number;
  threshold: number;
  severity: "info" | "warn" | "critical";
  actionsTaken: string[];   // ["notified", "paused-console:192.168.1.2"]
  resolvedTs?: number;      // when the metric came back in bounds
}
```

Retention: 1000 entries (ring buffer). Exportable to CSV/JSON alongside telemetry (§8.4).

### 7.6 The "alert if CPU > 85°C" gap, end-to-end

1. Telemetry stream pushes `{"temps":{"cpu":87}}` for console `192.168.1.2`.
2. Alert evaluator sees `temps.cpu > 85` for the 8th consecutive 2-s sample → 16 s > 10 s sustained.
3. Fires the rule: pushes a critical notification, pauses all tasks on that host (their status → `paused`, reason "thermal alert"), plays the error sound.
4. Logs an `AlertEvent` with `actionsTaken: ["notified","paused-console:192.168.1.2"]`.
5. Status bar bell gets a red badge with count.
6. Telemetry dashboard's CPU-temp graph gets a red vertical line at this ts.
7. When the CPU drops below 85 for 60 s (cooldown), the alert auto-resolves; the AlertEvent gets `resolvedTs` set; the user is offered "Resume paused tasks?".

---

## 8. Telemetry Dashboard

### 8.1 The telemetry stream (recap from v5-design §7.1)

One SSE endpoint `/api/ps5/telemetry/stream` pushes a combined snapshot every 2 s (or on-change). The client subscribes once and fans out. v5 adds: the client also writes each snapshot into a **ring buffer** for historical graphing.

### 8.2 Ring buffer

```ts
interface TelemetrySample {
  ts: number;
  host: string;
  temps: { cpu: number; soc: number; board: number };
  fan: { rpm: number; duty: number };
  power: { draw: number; voltage: number };
  storage: { internal: { free: number; total: number }; [k: string]: {...} };
  runningApp?: { titleId: string; name: string };
}

// store
interface TelemetryStore {
  byHost: Record<string, TelemetrySample[]>;  // ring buffer per host
  cap: number;                                 // default 43200 = 24 h @ 2 s
}
```

- Cap: 24 h of samples at 2-s cadence = 43 200 samples per host. At ~200 bytes/sample that's ~8.5 MB/host in memory — fine.
- Persistence: snapshots are flushed to a Tauri-side SQLite or DuckDB file every 60 s, rotating daily. Older data archived to `telemetry-YYYY-MM-DD.parquet` (optional; off by default, on for power users).
- Memory pressure guard: if the renderer's heap exceeds a threshold, the in-memory ring drops to 6 h and reads older data from disk on demand.

### 8.3 Live graphs

The Tasks → Telemetry sub-view:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Telemetry — PS5 Pro                       [Console ▾] [Range: 1h ▾]   │
│                                                                      │
│ ┌─ CPU temp ───────────────────────────────────────────────────────┐ │
│ │        ╱╲       ╱╲      87°C ⚠                                     │ │
│ │  62 ──╯  ╰─────╯  ╰────────────────────  Threshold 85 ─ ─ ─ ─ ─  │ │
│ │   │              ║alert║                                            │ │
│ │   0    15m    30m    45m    60m                                     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─ Fan duty ─────────────┐  ┌─ Power draw ─────────────────────────┐ │
│ │  35% ─────────────────│  │  85 W ─────╱╲──────                  │ │
│ └────────────────────────┘  └──────────────────────────────────────┘ │
│ ┌─ Storage free ─────────┐  ┌─ Running app ────────────────────────┐ │
│ │  245 ↓ 244 GiB         │  │  CUSA00506 Astro's Playroom  (12 m)  │ │
│ └────────────────────────┘  └──────────────────────────────────────┘ │
│                                                                      │
│ [Export ▾: CSV, JSON, Parquet]    [Alerts log →]                     │
└──────────────────────────────────────────────────────────────────────┘
```

- **Metrics graphed:** CPU temp, SoC temp, board temp, fan RPM, fan duty %, power draw (W), power voltage, storage free per volume.
- **Threshold lines:** every active AlertRule's threshold renders as a dashed horizontal line in the relevant graph. Crossing points are obvious.
- **Alert overlays:** AlertEvents render as vertical lines (║ in the ASCII above) spanning the graphs, color-coded by severity. Hover shows the rule + value.
- **Range selector:** 15 min, 1 h, 6 h, 24 h, 7 d (the last two read from disk).
- **Multi-metric overlay:** shift-click a second metric to overlay it on the same axis (e.g. fan duty over CPU temp).

### 8.4 Export

- **CSV:** one row per sample, columns `ts,host,metric,value`. Wide format option (`ts,host,cpu_temp,soc_temp,...`) for spreadsheet paste.
- **JSON:** nested per-sample objects.
- **Parquet:** columnar, for analysis in DuckDB / pandas. (Power-user feature; behind a setting.)
- **Scope:** export respects the current range + console filter + visible metrics. AlertEvents export as a separate companion file.
- **Where:** the Export button sits on the Telemetry sub-view; also reachable from History → "Export all data" which bundles tasks + audit + telemetry + alerts as a zip (this is the Bug Report payload, §11.4).

### 8.5 The "no historical graphs" gap, closed

v4 has live readouts (the Hardware screen polls) but no memory. v5 adds: ring buffer + SQLite/Parquet persistence + graphing + export. The Hardware screen is replaced by Console → Sensors (live readouts) and Tasks → Telemetry (graphs + history).

---

## 9. Statistics

### 9.1 The metrics

Materialized from the History store (so they're consistent with what the user can drill into) + the telemetry ring buffer. Computed lazily and cached; recomputed on a 5-min timer or on History mutation.

**Transfer totals**
- Total bytes uploaded / downloaded (this month, all-time)
- Total files transferred
- Total transfer time (wall-clock)
- Average throughput (MiB/s), with histogram

**Success rates**
- Overall task success rate (done / (done + failed + cancelled))
- Per-kind success rate (upload, install, backup, …)
- Install success rate by firmware version (the audit's specific ask — Sony's installer behaves differently per FW)
- Install success rate by SDK version
- First-attempt success rate vs. needed-retry rate

**Per-game**
- Time saved per game (backup → restore cycles × manual-effort estimate; or, for transfers, "auto-resume saved you N re-uploads of X GB")
- Play time (from GameActivity, joined)
- Number of installs / reinstalls
- Cheat mods active per game

**Failure causes**
- Breakdown by `errorReason` (the structured payload category): `direct_writer_io_error`, `fs_write_failed_errno_28`, `rar_password_required`, DRM-reject, …
- Top 10 failure causes by count + by total bytes wasted
- Failure trend over time (is your console getting flakier?)

**Storage**
- Storage saved by reconcile skips (sum of `skippedBytes` across upload-dir tasks)
- Storage saved by `deletePkgAfterInstall`
- Storage saved by backup compression
- Storage saved by dedup (if/when implemented)

**Telemetry-derived**
- Average / P95 CPU temp
- Average / P95 fan duty
- Average / peak power draw
- Thermal incidents (count of CPU-overheat alerts)

**Console comparison** (when multiple consoles)
- Per-console versions of all the above
- Side-by-side tables

### 9.2 The Statistics sub-view

```
┌──────────────────────────────────────────────────────────────────────┐
│ Statistics                            [Range: This month ▾] [Export]  │
│                                                                      │
│ ┌─ At a glance ─────────────────────────────────────────────────────┐ │
│ │  148 GB         94%          12m 17s        3.2 GB                 │ │
│ │  uploaded       success      avg upload     storage saved          │ │
│ │                                                              this  │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ Transfer trend ──────────────┐  ┌─ Success rate by kind ─────────┐ │
│ │   ╱╲   ╱╲                     │  │  Upload      ████████░ 96%      │ │
│ │  ╱  ╲_╱  ╲___                 │  │  Install     ███████░░ 88%      │ │
│ │             ╲╱                 │  │  Backup      █████████ 100%     │ │
│ │  week 1   2   3   4            │  │  Cheats dl   ██████░░░ 78%      │ │
│ └────────────────────────────────┘  └────────────────────────────────┘ │
│                                                                      │
│ ┌─ Failure causes (top 5) ────────────────────────────────────────┐   │
│ │  direct_writer_io_error    ████████████  42  (wifi drops)        │   │
│ │  fs_write_failed_errno_28  ██████        18  (out of space)      │   │
│ │  rar_password_required     ████          11                      │   │
│ │  drm_reject                ██             6                      │   │
│ │  payload_crashed           █              3                      │   │
│ └──────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│ ┌─ Install success by firmware ───────────────────────────────────┐   │
│ │  FW 12.02   ████████████████  100%  (8/8)                        │   │
│ │  FW 11.50   ██████████████░░   92%  (11/12)                      │   │
│ │  FW 11.00   ████████░░░░░░░░   55%  (6/11)  ⚠ investigate        │   │
│ └──────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│ ┌─ Per-game time saved ───────────────────────────────────────────┐   │
│ │  Astro's Playroom     3h 12m   (2 reinstalls avoided, 9 GB skip)  │   │
│ │  Rogue Company        1h 48m   (4 resume saves, 31 GB)            │   │
│ │  Demon's Souls        0h 55m   (1 backup restore)                 │   │
│ └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

Every tile is clickable → drills into the History rows behind it, filtered accordingly.

### 9.3 "Time saved" calculation

Honest, conservative, shown with its derivation:

- **Resume saves:** for each failed-then-resumed upload, `time saved = (bytes already on PS5 / measured throughput)`. Sum across the task's life.
- **Reconcile saves:** for each upload-dir with `skippedBytes > 0`, `time saved = skippedBytes / measured throughput`.
- **Backup restore vs. manual:** constant 15 min per save slot (configurable assumption in Settings → Statistics).
- **Avoided re-uploads:** count of "would have restarted from scratch in v4" events = retry count per task.
- Per-game rollup sums the tasks tagged with that `titleId`.

The "time saved this month" headline is the user-visible payoff of all the resume work — it makes the engineering tangible.

---

## 10. Disconnected / Recovery

### 10.1 Three disconnection scenarios

The audit conflates three distinct cases. They need distinct handling.

| Scenario | What actually happened | Detection | Default response |
|----------|-----------------------|-----------|------------------|
| **Network blip** | Wifi dropped for 2–30 s. Payload still running on PS5. | Transfer-port timeout; mgmt-port may still answer. | Auto-retry within attempt budget (§2.4). Resume via `txIdHex`. No user action required. |
| **Console rest mode / reboot** | User put PS5 in rest, or a game/app triggered it. Payload dies (kernel cleans up). Mgmt-port unreachable. | Mgmt-port heartbeat fails N times. | Tasks → `paused` with reason "console in rest mode". Queue preserved. On wake, banner offers resume. |
| **Console offline / powered off** | PS5 fully off or network-partitioned. | Mgmt-port unreachable for > 60 s. | Same as rest-mode initially; if > 10 min, banner offers "Give up and mark failed". |

### 10.2 The disconnect watcher

A single per-console watcher (runs in the scheduler) tracks mgmt-port reachability via the existing connection store. State transitions:

```
connected ──(miss 3 heartbeats)──▶ suspect ──(miss 6)──▶ disconnected
   ▲                                  │                      │
   │                                  │                      │
   └──(heartbeat ok)──────────────────┘                      │
   └──(heartbeat ok after rest-handshake)────────────────────────┘
```

- `suspect`: status bar shows a yellow dot. Running tasks keep their engine jobs (the blip may be transient).
- `disconnected`: all running tasks on that host flip to `paused` with reason. The scheduler stops admitting new tasks for that host. A global banner appears (§10.3).
- Recovery: when the heartbeat returns, the watcher waits for the payload handshake to complete (existing `ensurePayloadCurrent` logic), then transitions back to `connected`, fires the banner's "resume" affordance.

### 10.3 Global "Payload lost" banner

Persistent top-of-screen banner (below the header, above content), shown whenever:

- A console is `disconnected` AND has any non-terminal tasks.
- A console just came back AND has `paused` tasks awaiting resume.
- A payload was re-deployed (auto-recovery pushed a fresh ELF) — tells the user "your upload is resuming, not restarting".

States:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚠ PS5 Pro disconnected — 2 tasks paused.  [Retry connection] [×]      │  disconnected
├──────────────────────────────────────────────────────────────────────┤
│ ⟳ PS5 Pro in rest mode — payload lost. Tasks queued for resume.      │  rest
│    Will auto-resume when the console wakes.            [Wake via LAN]│
├──────────────────────────────────────────────────────────────────────┤
│ ✓ PS5 Pro back — 2 tasks ready to resume.           [Resume all] [×] │  back
├──────────────────────────────────────────────────────────────────────┤
│ ⟳ Resuming upload (didn't restart — saved 28 GiB)              [×]    │  redeploy
└──────────────────────────────────────────────────────────────────────┘
```

- Banner is dismissable for the info/warn states; the critical (rest mode with active tasks) state can be collapsed but not fully dismissed until tasks are resolved.
- "Wake via LAN" sends a WoL magic packet (existing capability).
- Multiple disconnected consoles stack banners.

### 10.4 Rest-mode recovery, end-to-end

1. User is uploading a 30 GB folder. PS5 enters rest mode (user action, low-battery, inactivity).
2. Disconnect watcher: mgmt-port heartbeat misses → `disconnected`.
3. Upload Task: `running` → `paused`, reason "console entered rest mode". Engine job is dead but the payload journal on the PS5's SSD persists the tx.
4. Banner appears: "PS5 Pro in rest mode — payload lost. Tasks queued for resume."
5. Queue: the rest of the queue stays `ready` for this host (not admitted, no slot).
6. User wakes the PS5 (power button, controller, or "Wake via LAN").
7. Watcher sees mgmt-port answer → runs `ensurePayloadCurrent` (re-deploys the ELF since rest killed it).
8. Banner transitions: "PS5 Pro back — 1 task ready to resume. [Resume all]".
9. User clicks Resume (or the scheduler auto-resumes if Settings → Tasks → "Auto-resume after rest" is on, default on).
10. New engine job minted; `TX_FLAG_RESUME` + `txIdHex` → payload reads its journal → resume from last-acked shard. No bytes re-sent.

### 10.5 Reboot recovery

Same as rest-mode, except:
- The PS5's filesystem state is preserved (rest doesn't unmount), so resumed uploads find their journal intact.
- A full power-off (cold boot) preserves the SSD but the payload's in-memory journal is gone. In this case the reconcile mode re-hashes what's on the PS5 and re-sends only the missing tail — slightly more work than rest-resume, still vastly less than a fresh upload.

### 10.6 Queue preservation across app restart

- The scheduler's queue (`pending` + `paused` tasks) is persisted to `tasks.json` on every mutation (debounced 300 ms, same as today).
- On app restart: hydrate `tasks.json`, reset any `running` → `pending`, keep `paused`.
- Disconnect watcher re-evaluates each known console on startup; banners appear as needed.

### 10.7 What's NOT auto-recovered

- **Destructive ops half-done:** if an `fs-delete` was mid-tree when the console dropped, we do NOT auto-resume it on reconnect — the user might have changed something. Instead the Task stays `paused` with a clear "3 of 12 items deleted before disconnect — Resume? Cancel?" prompt.
- **Backup-restore half-applied:** same — pause and prompt, never silently continue a destructive restore.

---

## 11. History Consolidation

### 11.1 The four stores, kept separate (different permanence)

| Store | v4 location | Retention | Purpose | v5 location |
|-------|-------------|-----------|---------|-------------|
| **Activity** | `state/activityHistory.ts` (localStorage, 100-cap ring) | ~100 most recent ops | "did that thing finish?" — transient outcomes, the everyday log | **Tasks → History** (primary feed) |
| **AuditLog** | `state/auditLog.ts` (localStorage, 256-cap append-only) | 256 destructive actions, no clear() | "what destructive thing happened that I might want to attribute?" | **Tasks → History → Audit tab** (filter) |
| **Logs** | `state/logs.ts` (engine + client) | rolling, large | diagnostic — debug a bug | **Tasks → History → Diagnostic tab** + Drawer → Logs (unchanged) |
| **GameActivity** | `state/playTime.ts` (per-title play sessions) | unlimited (per-game) | play time | **Game Hub → Activity** (per-game) + **Tasks → History → Play time tab** (aggregate) |

**Why not merge the stores?** Each has different write-rate (Activity: 5 Hz during uploads; Audit: rare; Logs: 100 Hz; GameActivity: per-session), different retention need, and different readers. Merging would force the lowest-common-denominator retention on all four. Instead we keep the stores and unify the *view*.

### 11.2 The unified History view

Tasks → History renders a single timeline that joins the four stores on `(ts, host)`:

```
┌──────────────────────────────────────────────────────────────────────┐
│ History                                                              │
│                                                                      │
│ [Filters: All ▾] [Console ▾] [Kind ▾] [Outcome ▾] [Date range]       │
│                                                                      │
│ ╭─ 2026-08-02 ─────────────────────────────────────────────────────╮ │
│ │ 14:32  ✓ upload  /data/themes/dark.css            14 KiB    2s    │ │
│ │ 14:28  ⚠ install Rogue.pkg  rejected (DRM)                  1m     │ │
│ │ 14:20  ⊘ audit   library-unregister  CUSA00506                —    │ │
│ │ 14:18  ✓ backup  snapshot "pre-FW12"             8.4 GB    12m     │ │
│ │ 13:55  — log     [engine] payload re-deployed (v4.3.2)              │ │
│ │ 13:40  — game    played Astro's Playroom          42 min            │ │
│ ╰────────────────────────────────────────────────────────────────────╯ │
│                                                                      │
│ Showing 6 of 1,247   [Load more]            [Export ▾] [Bug report]  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Single timeline, type-tagged rows.** Each row has a type icon (✓⚠⊘ for Activity, — for Logs/Audit/GameActivity) and a row-class-specific subtitle.
- **Filters** narrow by source (Activity / Audit / Logs / Play-time), kind, outcome, console, date range. Default: Activity + Audit (the everyday view); Logs and Play-time are opt-in (they're noisy / out-of-band).
- **Search** full-text across all sources.
- **Join on task_id**: an Activity row that has `auditIds` shows "+2 audit entries" — expanding reveals them inline. A Logs entry correlated to a task (by trace_id) shows the task link.

### 11.3 Bug Report as an action

Per the workflow finding, Bug Report is not a destination — it's an action available *from within* History (and from any failed task row):

```
┌─ Bug report ─────────────────────────────────────────────────────┐
│ Scope: (•) This task: "install Rogue.pkg failed (DRM)"            │
│        ( ) Last 1 hour of all history                             │
│        ( ) Custom range…                                          │
│                                                                  │
│ Include:                                                         │
│  [✓] Task record (config + outcome + retry history)              │
│  [✓] Audit log entries in range                                  │
│  [✓] Diagnostic logs in range (redact paths optional)            │
│  [✓] Telemetry snapshots in range                                │
│  [✓] Alert events in range                                       │
│  [ ] Screenshots (you can attach manually)                       │
│                                                                  │
│ Notes:                                                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ What were you trying to do? What happened instead?         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ Privacy: [✓] Redact local paths  [✓] Redact console IPs          │
│                                                                  │
│              [Generate .zip]    [Copy to clipboard]               │
└──────────────────────────────────────────────────────────────────┘
```

- Generates a zip with: the selected task record(s) as JSON, the filtered Audit/Logs/Telemetry/Alerts as JSON + CSV, the user's notes as `notes.md`, and an auto-filled `summary.md` with the environment info (app version, engine version, payload version, console FW).
- Privacy-first defaults: local paths and console IPs are redacted unless explicitly disabled.
- Replaces the standalone Bug Report screen entirely.

### 11.4 The troubleshooter's single pane

The audit's "troubleshooter hits 4 overlapping history screens" finding is resolved: one History view, four filter pills, every question answerable without navigation. Cmd-K shortcuts jump to filtered views: `cmd-k "failed installs today"`.

---

## 12. Automation

### 12.1 What's automated

Three trigger types (the existing `schedules.ts` handles only the first, weakly):

```ts
type Trigger =
  | { kind: "schedule"; cron: string }              // "0 3 * * *" = nightly 03:00
  | { kind: "event"; event: EventKind }             // on-launch, on-connect, on-rest-exit
  | { kind: "manual" };                             // only runs when user clicks

type EventKind =
  | "on-connect"        // console comes online
  | "on-disconnect"
  | "on-launch"         // user launches a game
  | "on-quit"           // game exits
  | "on-rest-exit"      // console wakes from rest
  | "on-storage-low";   // storage-free alert fires
```

### 12.2 The Automation store

Extends `schedules.ts` to a richer shape:

```ts
interface Automation {
  id: string;
  enabled: boolean;
  label: string;
  trigger: Trigger;
  /** What to run: a task template (single op) or a pipeline template. */
  action:
    | { kind: "task"; taskKind: TaskKind; payload: Partial<TaskPayload> }
    | { kind: "pipeline"; templateId: string; bindings: Record<string, unknown> };
  /** Per-trigger target console. "*" = all consoles (the trigger fires
   *  per-console; e.g. on-connect fires once per console that connects). */
  host: string | "*";
  /** Only fire if these conditions hold (e.g. "only if it's been > 24 h
   *  since the last backup of this game"). */
  guard?: Condition;
  lastFiredMs?: number;
  lastFireResult?: "ok" | "skipped-by-guard" | "failed";
}
```

### 12.3 Examples (the audit's specific asks)

- **"Backup nightly"** — `trigger: { kind: "schedule", cron: "0 3 * * *" }`, `action: { kind: "pipeline", templateId: "nightly-backup" }`, `host: "*"` → each console's saves back up at 03:00.
- **"On-launch → backup save"** — `trigger: { kind: "event", event: "on-launch" }`, `action: { kind: "task", taskKind: "save-backup", payload: { scope: "current-game" } }`. When the user launches a game, that game's saves back up first.
- **"On-connect → sync cheats"** — `trigger: { kind: "event", event: "on-connect" }`, `action: { kind: "task", taskKind: "cheat-download", payload: { engine: "goldhen" } }`.
- **"On-rest-exit → resume paused"** — `trigger: { kind: "event", event: "on-rest-exit" }`, `action: { kind: "task", taskKind: "builtin:resume-all-paused" }`. Closes the rest-mode loop automatically.
- **"On-storage-low → pause uploads + notify"** — `trigger: { kind: "event", event: "on-storage-low" }`, `action: { kind: "task", taskKind: "builtin:pause-uploads" }`.

### 12.4 Where configured

**Settings → Automation** lists all automations with enable toggles, last-fired, last-result. "New automation" opens a form:

```
┌─ New automation ───────────────────────────────────────────────────┐
│ Label: [Nightly backup                                       ]      │
│                                                                    │
│ Trigger:  (•) Schedule   ( ) Event   ( ) Manual only               │
│           Cron: [0 3 * * *]   ↳ "every day at 03:00"               │
│                                                                    │
│ Action:   (•) Pipeline   ( ) Single task                           │
│           Pipeline: [nightly-backup ▾]                             │
│           Target console: (•) All  ( ) PS5 Pro  ( ) PS5 Slim       │
│                                                                    │
│ Guard (optional):                                                  │
│   [✓] Only if last backup was > 20 h ago                           │
│                                                                    │
│                                          [Cancel]  [Save]           │
└────────────────────────────────────────────────────────────────────┘
```

Pipeline templates (§5.3) bind into automations: an automation that runs a pipeline just instantiates the template on each firing.

### 12.5 The "only fires while app is open" caveat

v4's `schedules.ts` only fires while the Tauri window is open (documented limitation). v5 keeps this limitation for browser-context automations, but adds:

- **Engine-side scheduler** (optional, off by default): the engine runs its own cron loop and can fire automations even when no client is connected. Requires the engine to be running as a daemon (Docker / systemd). Surfaced as "Background scheduler: enabled" in Settings.
- **System cron fallback**: the Settings → Automation screen shows a "Generate crontab line" button that produces a `curl` invocation against the engine's HTTP API, for users who want OS-level cron without the daemon.

### 12.6 Manual "run now"

Every automation has a "Run now" button (fires immediately, ignoring the trigger, respecting the guard). Useful for testing.

---

## 13. Multi-Console Task View

### 13.1 Console filter

Every sub-view of Tasks has a Console selector (top-right). Options:
- A specific console (only that host's tasks)
- "All consoles" (default — unified view)
- "Group by console" toggle (clusters rows under per-console headers)

### 13.2 The multi-console Active view

```
┌──────────────────────────────────────────────────────────────────────┐
│ Tasks — All consoles (grouped)                                       │
│                                                                      │
│ ▼ PS5 Pro — 192.168.1.2                                              │
│   ▶ Installing Astro's Playroom       2.1/3.2 GiB   14 MiB/s         │
│   ⟳ Upload /data/Rogue.pkg (recovering)  18/30 GiB                  │
│ ▼ PS5 Slim — 192.168.1.3                                             │
│   ▶ Backup "nightly"                  12%                            │
│   ⏸ Upload themes (paused — thermal alert)                           │
│ ▼ PS5 Dev — 192.168.1.4                                              │
│   (idle)                                                              │
└──────────────────────────────────────────────────────────────────────┘
```

### 13.3 Cross-console operations

- **Bulk actions across consoles**: select rows on multiple consoles → bulk pause/cancel/priority. Each console's scheduler honors the action independently.
- **Migrate task**: right-click a task → "Move to console…" re-targets it. For uploads, re-resolves the dest path on the new console. For installs, re-checks the staged file's presence.
- **Compare stats**: Statistics sub-view → "Compare consoles" produces side-by-side tables (success rate, throughput, thermal incidents).

### 13.4 The multi-console alert aggregator

Status bar's alert bell aggregates across all consoles — "2 critical (1 on Pro, 1 on Slim)". Clicking opens a list with per-console breakdown.

### 13.5 Roster-level disconnect

If *every* console is disconnected, the banner upgrades to "All consoles offline — N tasks paused across M consoles." The app still works (you can browse History, edit automations, configure templates); tasks resume as consoles return.

---

## 14. Gap-to-Section Cross-Reference

The 12 audit gaps, where they're addressed:

| # | Gap | Section |
|---|-----|---------|
| 1 | No retry / re-run from history | §4 (Retry), §2.3 (recoverability table), §4.4 (the 30 GB case) |
| 2 | No task dependencies / chaining | §5 (Pipelines) — `dependsOn`, visual editor, per-game "Full setup" |
| 3 | No task priority / queue management | §6 (Queue) — scheduler, priority, concurrency caps, pause-one |
| 4 | Statistics missing key metrics | §9 — per-game time-saved, failure-cause breakdown, storage-saved, install-success by FW |
| 5 | Disconnected-console handling | §10.1–10.3 — disconnect watcher, three scenarios, global banner |
| 6 | Rest-mode / reboot recovery | §10.4–10.5 — end-to-end, payload-lost banner, queue preservation |
| 7 | Partial-failure surfacing | §3.3 (View N skipped), §1.4 (skippedFiles/skippedBytes on Task), §11 (History detail) |
| 8 | Storage-full pre-flight | §7.3 (storage-low + storage-critical alerts), §6 (scheduler refuses to admit upload if cap-evaluation says no space) |
| 9 | No alerts/thresholds on telemetry | §7 (Alerts) — rules, default thresholds, actions, historical log |
| 10 | No historical graphs / data export | §8 (Telemetry dashboard) — ring buffer, graphs, CSV/JSON/Parquet export |
| 11 | No automation/scheduling | §12 (Automation) — cron, event triggers, pipeline templates |
| 12 | No multi-console task view | §13 (Multi-console) — grouping, compare, cross-console ops |

### On the redundancy audit

- **4 history surfaces**: kept as 4 stores, unified under one History view (§11). Justified per-store.
- **Engine jobs (256-cap, terminal-evicting) vs client Activity (durable)**: cross-referenced via `engineJobId` on the Task (§1.1) + durability-ack handoff (§2.5) so eviction can't lose unobserved data.
- **Troubleshooter's 4 screens → 1**: History sub-view with filters (§11.4).
- **Bug Report as action, not destination**: §11.3.
- **Returning user → dashboard/status, not changelog**: §3.4.

---

## Appendix A: Store inventory after v5

| Store | Status | Change |
|-------|--------|--------|
| `activityHistory.ts` | **Kept** | Add `taskId` field; ActivityEntry gains a back-ref to the unified Task. |
| `auditLog.ts` | **Kept** | Unchanged. |
| `logs.ts` | **Kept** | Unchanged. |
| `playTime.ts` | **Kept** | Unchanged. |
| `uploadQueue.ts` | **Generalized → tasks store** | The scheduler's queue. QueueItem fields fold into Task; the `runningHosts` map becomes the scheduler's per-host admission state. |
| `fsBulkOp.ts` | **Generalized → tasks store** | BulkOpState/DownloadOpState become running-state on the corresponding fs Task. |
| `pkgLibrary.ts` | **Kept** | Still tracks installed pkgs; install tasks link to entries here. |
| `schedules.ts` | **Generalized → automations store** | Schedule gains trigger variety + action variety (§12.2). |
| **NEW** `tasks.ts` | The unified Task store + scheduler. | The spine of §1–§6. |
| **NEW** `alerts.ts` | Alert rules + AlertLog. | §7. |
| **NEW** `telemetryHistory.ts` | Ring buffer + persistence. | §8. |
| **NEW** `pipelines.ts` | Templates (built-in + user) + instances. | §5. |

## Appendix B: Engine changes

- Route `fs/delete`, `fs/copy`, `fs/move`, `pkg/install/start`, `backup/snapshot`, `backup/restore`, `cheats/repos/download`, `tmdb/fetch` through the unified `jobs` map. Each returns `{"job_id": "..."}` immediately and emits `job_progress` / `job_complete` / `job_failed` on the existing SSE. Old endpoints (`fs/op-status`, `pkg/install/status`) become thin wrappers that create a job internally and poll — deprecate but don't break v4.
- Add `/api/jobs/:id/ack` for the durability handoff (§2.5).
- Add `/api/ps5/telemetry/stream` SSE (already designed in v5 §7.1).
- Add `POST /api/automations/fire` so external cron can trigger an automation by id.
- The `jobs` map cap stays at 256; the durability-ack policy makes it safe.

## Appendix C: Not in scope (explicit non-goals)

- **Cloud sync** of tasks / telemetry (future — would need an account model).
- **Plugin system** for third-party task kinds (future).
- **Per-user accounts** on a shared console (the PS5 has its own user model; we don't re-model it).
- **Mobile background execution** — Tauri mobile can't run schedules in the background; documented limitation persists (§12.5).
- **Real-time collaboration** (multiple clients editing one console's queue) — out of scope; the engine is single-owner.

---

*This document is the plan of record for the v5 Tasks tab. It supersedes §6 of `v5-design.md`; the rest of v5-design (navigation, Game Hub, components, visual language) stands.*
