/**
 * Unified Task List (v5 §9.2).
 *
 * Renders active + recent tasks from the unified `useTaskStore` (§10).
 * Each row shows: kind icon, label, progress bar, rate, ETA, and a
 * context menu (cancel / retry / dismiss). Terminal tasks show their
 * outcome and a dismiss button.
 *
 * This is the "Active view" of the Tasks tab — it aggregates every
 * long-running operation across the app into one live list.
 */
import { useEffect, useState } from "react";
import {
  Upload,
  Download,
  FileX,
  Copy,
  FolderInput,
  Package,
  Save,
  ArchiveRestore,
  Gamepad2,
  Image as ImageIcon,
  Server,
  Play,
  SquareDot,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
  PlayCircle,
  X,
  RotateCcw,
} from "lucide-react";
import clsx from "clsx";

import { ProgressBar } from "./ProgressBar";
import { Badge } from "./Badge";
import { Spinner } from "./Spinner";
import { ConsoleChip } from "./ConsoleChip";
import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { useTr } from "../state/lang";
import {
  useTaskStore,
  isTerminal,
  isActivatable,
  type Task,
  type TaskKind,
  type TaskStatus,
} from "../state/tasks";
import { formatBytes, formatDuration } from "../lib/format";
import { useRosterStore } from "../state/roster";

/** Render the icon for a TaskKind. */
function KindIcon({ kind, size = 14 }: { kind: TaskKind; size?: number }) {
  const Icon = kindIconMap[kind] ?? SquareDot;
  return <Icon size={size} strokeWidth={1.75} className="shrink-0 text-[var(--color-muted)]" />;
}

const kindIconMap: Record<TaskKind, typeof Upload> = {
  "upload-file": Upload,
  "upload-dir": Upload,
  "upload-archive": Upload,
  "download": Download,
  "fs-delete": FileX,
  "fs-copy": Copy,
  "fs-move": FolderInput,
  "fs-rename": FolderInput,
  "pkg-install": Package,
  "pkg-dpi-install": Package,
  "save-backup": Save,
  "backup-snapshot": Save,
  "save-restore": ArchiveRestore,
  "backup-restore": ArchiveRestore,
  "cheat-download": Gamepad2,
  "icon-fetch": ImageIcon,
  "library-mount": Server,
  "library-register": Play,
  "library-unregister": Play,
  "library-launch": Play,
};

/** Status → icon element for the row's left badge. */
function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case "running":
      return <Spinner size={14} tone="accent" />;
    case "queued":
      return <Clock size={13} className="text-[var(--color-muted)]" />;
    case "paused":
      return <Pause size={13} className="text-[var(--color-warn)]" />;
    case "awaiting":
      return <Clock size={13} className="text-[var(--color-warn)]" />;
    case "done":
      return <CheckCircle2 size={13} className="text-[var(--color-good)]" />;
    case "failed":
      return <XCircle size={13} className="text-[var(--color-bad)]" />;
    case "cancelled":
      return <XCircle size={13} className="text-[var(--color-muted)]" />;
    case "interrupted":
      return <AlertCircle size={13} className="text-[var(--color-warn)]" />;
    default:
      return null;
  }
}

/** Progress bar tone based on status. */
function progressTone(status: TaskStatus): "accent" | "good" | "warn" | "bad" {
  if (status === "done") return "good";
  if (status === "failed") return "bad";
  if (status === "paused" || status === "interrupted") return "warn";
  return "accent";
}

/** Compute progress fraction 0..1 from Task.progress, if available. */
function progressFraction(task: Task): number | null {
  if (!task.progress || task.progress.total <= 0) return null;
  return task.progress.current / task.progress.total;
}

/** Format an ETA (seconds) into a compact human string. */
function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** Human label for a TaskStatus. */
function statusLabel(
  status: TaskStatus,
  tr: (key: string, vars?: Record<string, string | number>, fallback?: string) => string,
): string {
  switch (status) {
    case "running":
      return tr("task_status_running", undefined, "Running");
    case "queued":
      return tr("task_status_queued", undefined, "Queued");
    case "paused":
      return tr("task_status_paused", undefined, "Paused");
    case "awaiting":
      return tr("task_status_awaiting", undefined, "Waiting");
    case "done":
      return tr("task_status_done", undefined, "Done");
    case "failed":
      return tr("task_status_failed", undefined, "Failed");
    case "cancelled":
      return tr("task_status_cancelled", undefined, "Cancelled");
    case "interrupted":
      return tr("task_status_interrupted", undefined, "Interrupted");
    default:
      return status;
  }
}

/** One task row. */
function TaskRow({ task }: { task: Task }) {
  const tr = useTr();
  const removeTask = useTaskStore((s) => s.removeTask);
  const finishTask = useTaskStore((s) => s.finishTask);
  const profiles = useRosterStore((s) => s.profiles);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second for running tasks so elapsed/ETA updates live.
  useEffect(() => {
    if (isTerminal(task.status)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [task.status]);

  const pct = progressFraction(task);
  const isActive = isActivatable(task.status);
  const isDone = task.status === "done";
  const isFailed = task.status === "failed" || task.status === "interrupted";

  // Elapsed time
  const endMs = task.endedAtMs ?? now;
  const elapsedMs = Math.max(0, endMs - new Date(task.createdAt).getTime());

  // Rate display
  const rate = task.rate?.bytesPerSec ?? 0;

  // Border color by status
  const borderClass =
    task.status === "running"
      ? "border-[var(--color-accent)]"
      : isDone
        ? "border-[var(--color-good)]"
        : isFailed
          ? "border-[var(--color-bad)]"
          : "border-[var(--color-border)]";

  // Overflow menu items
  const menuItems: OverflowMenuItem[] = [];
  if (isActive) {
    menuItems.push({
      label: tr("task_cancel", undefined, "Cancel"),
      icon: <X size={12} />,
      onSelect: () => finishTask(task.id, "cancelled"),
    });
  }
  if (task.status === "paused") {
    menuItems.push({
      label: tr("task_resume", undefined, "Resume"),
      icon: <PlayCircle size={12} />,
      onSelect: () =>
        useTaskStore.getState().updateTask(task.id, { status: "running" }),
    });
  }
  if (task.status === "running") {
    menuItems.push({
      label: tr("task_pause", undefined, "Pause"),
      icon: <Pause size={12} />,
      onSelect: () =>
        useTaskStore.getState().updateTask(task.id, { status: "paused" }),
    });
  }
  if (isFailed) {
    menuItems.push({
      label: tr("task_retry", undefined, "Retry"),
      icon: <RotateCcw size={12} />,
      onSelect: () =>
        useTaskStore.getState().updateTask(task.id, { status: "queued" }),
    });
  }
  if (isTerminal(task.status)) {
    menuItems.push({
      label: tr("task_dismiss", undefined, "Dismiss"),
      icon: <X size={12} />,
      onSelect: () => removeTask(task.id),
    });
  }

  return (
    <li
      className={clsx(
        "rounded-md border bg-[var(--color-surface-2)] p-3 text-xs",
        borderClass,
      )}
    >
      {/* Row 1: icon + label + console + time + menu */}
      <div className="mb-1.5 flex items-center gap-2">
        <StatusIcon status={task.status} />
        <KindIcon kind={task.kind} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {task.label}
        </span>
        <ConsoleChip
          addr={profiles.length > 1 ? `${task.consoleId}:9114` : undefined}
          className="shrink-0"
        />
        <span className="shrink-0 text-[var(--color-muted)]">
          {formatDuration(elapsedMs / 1000)}
        </span>
        {menuItems.length > 0 && (
          <OverflowMenu
            items={menuItems}
            ariaLabel={tr("task_actions", undefined, "Task actions")}
            buttonTitle={tr("task_actions", undefined, "Task actions")}
          />
        )}
      </div>

      {/* Row 2: detail (from/to paths) */}
      {task.detail && (
        <div className="mb-1.5 break-all font-mono text-[var(--color-muted)]">
          {task.detail}
        </div>
      )}

      {/* Row 3: progress bar */}
      {pct !== null && (
        <div className="mb-1">
          <ProgressBar
            value={pct}
            tone={progressTone(task.status)}
            size="sm"
            paused={task.status === "paused"}
            label={task.label}
          />
        </div>
      )}

      {/* Row 4: stats line */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[var(--color-muted)]">
        {task.progress && task.progress.total > 0 && (
          <span>
            {formatBytes(task.progress.current)} / {formatBytes(task.progress.total)}
            {pct !== null && ` (${(pct * 100).toFixed(0)}%)`}
          </span>
        )}
        {rate > 0 && isActive && (
          <span>{formatBytes(rate)}/s</span>
        )}
        {task.eta != null && isActive && task.eta > 0 && (
          <span>
            {tr("task_eta", undefined, "ETA")} {formatEta(task.eta)}
          </span>
        )}
        <span className="font-medium">
          {statusLabel(task.status, tr)}
        </span>
        {task.attempts > 1 && (
          <Badge tone="neutral" variant="soft">
            {tr("task_attempts", { n: task.attempts }, `×${task.attempts}`)}
          </Badge>
        )}
      </div>

      {/* Error message */}
      {task.lastError && (
        <div className="mt-1 text-[var(--color-bad)]">
          {task.lastError.message}
        </div>
      )}
    </li>
  );
}

/**
 * Full task list — active tasks on top, finished below.
 * Active tasks are sorted by updatedAtMs (most recent change first).
 * Finished tasks are sorted by endedAtMs (newest first).
 */
export function TaskList({ maxFinished = 20 }: { maxFinished?: number }) {
  const tr = useTr();
  const tasks = useTaskStore((s) => s.tasks);
  const clearFinished = useTaskStore((s) => s.clearFinished);

  const active = tasks
    .filter((t) => isActivatable(t.status))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  const finished = tasks
    .filter((t) => isTerminal(t.status))
    .sort((a, b) => (b.endedAtMs ?? 0) - (a.endedAtMs ?? 0))
    .slice(0, maxFinished);

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <section>
          <header className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            <Spinner size={14} />
            {tr("task_active", undefined, "Active")}
            <span className="text-xs">· {active.length}</span>
          </header>
          <ul className="space-y-2">
            {active.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <header className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            {tr("task_recent", undefined, "Recently finished")}
            <span className="text-xs">· {finished.length}</span>
            <button
              type="button"
              onClick={clearFinished}
              className="ml-auto rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs normal-case tracking-normal hover:bg-[var(--color-surface-3)]"
            >
              {tr("task_clear_finished", undefined, "Clear finished")}
            </button>
          </header>
          <ul className="space-y-2">
            {finished.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Badge showing the count of active tasks — for use in tab bars, headers. */
export function ActiveTaskCount() {
  const count = useTaskStore((s) => s.tasks.filter((t) => isActivatable(t.status)).length);
  if (count === 0) return null;
  return (
    <Badge tone="accent" variant="solid">
      {count}
    </Badge>
  );
}
