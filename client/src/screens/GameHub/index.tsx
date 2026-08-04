/**
 * Game Hub (v5 §6.2).
 *
 * Everything about one game behind one URL: `/games/:title_id`.
 *
 * Header: game icon, name, title_id, firmware, size, launch actions.
 * Tabs: Overview · Cheats · Saves · Media · Add-ons · Updates · Storage · Play Time
 *
 * The tab content is rendered by sub-components that lazily fetch their
 * own data. Most tabs start as placeholder shells that the user can
 * navigate to; each gets fleshed out in subsequent phases.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Gamepad2,
  Info,
  Save,
  Image as ImageIcon,
  Package,
  Download,
  HardDrive,
  Clock,
  Shield,
  Play,
} from "lucide-react";

import { PageHeader, Button, Tabs, Badge, EmptyState, Card } from "../../components";
import { GameIcon } from "../../components/GameIcon";
import { useTr } from "../../state/lang";
import { useLibraryStore, libraryForHost } from "../../state/library";
import { useConnectionStore } from "../../state/connection";
import {
  usePlayTimeStore,
  playSecondsFor,
  lastSeenPlayingFor,
} from "../../state/playTime";
import { appsInstalled, type InstalledTitle } from "../../api/ps5";
import { transferAddr } from "../../lib/addr";
import { formatBytes, formatDuration } from "../../lib/format";

const TAB_IDS = [
  "overview",
  "cheats",
  "saves",
  "media",
  "addons",
  "updates",
  "storage",
  "playtime",
] as const;

type TabId = (typeof TAB_IDS)[number];

export default function GameHubScreen() {
  const { title_id } = useParams<{ title_id: string }>();
  const tr = useTr();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const entries = useLibraryStore((s) => libraryForHost(s, host).entries);
  const playTimeState = usePlayTimeStore();
  const [installedTitles, setInstalledTitles] = useState<InstalledTitle[]>([]);

  // Fetch installed apps when connected, so we can resolve title_id → name
  // for games not in the library scan (e.g. system apps).
  useEffect(() => {
    if (!host?.trim() || payloadStatus !== "up") return;
    let cancelled = false;
    appsInstalled(transferAddr(host.trim()))
      .then((res) => {
        if (!cancelled) setInstalledTitles(res.titles);
      })
      .catch(() => {
        // Non-fatal — library entries are the primary source.
      });
    return () => {
      cancelled = true;
    };
  }, [host, payloadStatus]);

  // Determine the active tab from URL ?tab=
  const tabParam = searchParams.get("tab");
  const activeTab: TabId =
    TAB_IDS.find((t) => t === tabParam) ?? "overview";

  // Find the game in the library or installed apps
  const game = useMemo(() => {
    if (!title_id) return null;
    // Check library entries first (games on disk)
    const libEntry = entries?.find((e) => e.titleId === title_id);
    if (libEntry) {
      return {
        titleId: title_id,
        name: libEntry.name,
        path: libEntry.path,
        size: libEntry.size,
        source: "library" as const,
      };
    }
    // Check installed apps (fetched inline from the engine)
    const app = installedTitles.find((a) => a.titleId === title_id);
    if (app) {
      return {
        titleId: title_id,
        name: app.titleName ?? title_id,
        path: app.source || "",
        size: 0,
        source: "installed" as const,
      };
    }
    return null;
  }, [title_id, entries, installedTitles]);

  const playSeconds = playSecondsFor(playTimeState, host, title_id ?? null);
  const lastSeenMs = lastSeenPlayingFor(playTimeState, host, title_id ?? null);

  const tabs = useMemo(
    () =>
      TAB_IDS.map((id) => ({
        id,
        label: tabLabel(id, tr),
        icon: tabIcon(id),
      })),
    [tr],
  );

  if (!title_id) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Gamepad2}
          title={tr("game_hub_not_found", undefined, "Game not found")}
          message={tr(
            "game_hub_not_found_desc",
            undefined,
            "This title ID does not match any installed or library game.",
          )}
        />
      </div>
    );
  }

  if (!game) {
    const connected = payloadStatus === "up";
    return (
      <div className="p-6">
        <PageHeader
          icon={Gamepad2}
          title={title_id}
          description={tr("game_hub_not_found", undefined, "Game not found")}
          right={
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft size={16} />}
              onClick={() => navigate("/games")}
            >
              {tr("game_hub_back", undefined, "Back to library")}
            </Button>
          }
        />
        <EmptyState
          icon={Gamepad2}
          title={tr("game_hub_not_found", undefined, "Game not found")}
          message={
            connected
              ? tr(
                  "game_hub_not_found_desc",
                  undefined,
                  "This title ID does not match any installed or library game.",
                )
              : tr("v5_home_disconnected", undefined, "Not connected")
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      {/* Header */}
      <header className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <Link
            to="/games"
            className="flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={14} />
            {tr("game_hub_back", undefined, "Back to library")}
          </Link>
        </div>

        <div className="flex items-start gap-4">
          {/* Game icon */}
          <GameIcon
            host={host ?? ""}
            titleId={game.titleId}
            gamePath={game.path}
            alt={game.name}
            size={80}
            rounded="rounded-xl"
            className="shrink-0"
          />

          {/* Title + meta */}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold tracking-tight">
              {game.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[var(--color-muted)]">
              <span className="font-mono">{game.titleId}</span>
              {game.size > 0 && <span>· {formatBytes(game.size)}</span>}
              {playSeconds !== undefined && playSeconds > 0 && (
                <span>· {formatDuration(playSeconds)}</span>
              )}
              <Badge tone="neutral" variant="soft">
                {game.source === "library" ? "Library" : "Installed"}
              </Badge>
            </div>
          </div>

          {/* Launch actions */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Play size={14} />}
              onClick={() => {
                /* TODO: wire to ps5_app_launch */
              }}
            >
              {tr("game_hub_launch", undefined, "Launch")}
            </Button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        value={activeTab}
        onChange={(id) => setSearchParams({ tab: id })}
        variant="underline"
        ariaLabel={tr("game_hub_overview", undefined, "Game tabs")}
        className="mb-6"
      />

      {/* Tab content */}
      <GameTabContent game={game} playSeconds={playSeconds} lastSeenMs={lastSeenMs} tab={activeTab} />
    </div>
  );
}

/** Render the content for the active tab. */
function GameTabContent({
  tab,
  game,
  playSeconds,
  lastSeenMs,
}: {
  tab: TabId;
  game: GameInfo;
  playSeconds: number | undefined;
  lastSeenMs: number | undefined;
}) {
  const tr = useTr();

  switch (tab) {
    case "overview":
      return <OverviewTab game={game} playSeconds={playSeconds} lastSeenMs={lastSeenMs} />;
    case "cheats":
      return (
        <PlaceholderTab
          icon={Shield}
          title={tr("game_hub_cheats", undefined, "Cheats")}
          desc="Cheat file management: list of available cheats per trainer, toggle per-cheat, auto-apply profile."
        />
      );
    case "saves":
      return (
        <PlaceholderTab
          icon={Save}
          title={tr("game_hub_saves", undefined, "Saves")}
          desc="Save slots with version history, backup, restore, compare."
        />
      );
    case "media":
      return (
        <PlaceholderTab
          icon={ImageIcon}
          title={tr("game_hub_media", undefined, "Media")}
          desc="Screenshots and videos for this game."
        />
      );
    case "addons":
      return (
        <PlaceholderTab
          icon={Package}
          title={tr("game_hub_addons", undefined, "Add-ons")}
          desc="DLC list — installed and available."
        />
      );
    case "updates":
      return (
        <PlaceholderTab
          icon={Download}
          title={tr("game_hub_updates", undefined, "Updates")}
          desc="Available patches, current version, patch history."
        />
      );
    case "storage":
      return <StorageTab game={game} />;
    case "playtime":
      return <PlayTimeTab playSeconds={playSeconds} lastSeenMs={lastSeenMs} />;
    default:
      return null;
  }
}

interface GameInfo {
  titleId: string;
  name: string;
  path: string;
  size: number;
  source: "library" | "installed";
}

/** Overview tab — game info, description, play time, last played. */
function OverviewTab({
  game,
  playSeconds,
  lastSeenMs,
}: {
  game: GameInfo;
  playSeconds: number | undefined;
  lastSeenMs: number | undefined;
}) {
  const tr = useTr();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="mb-3 text-sm font-semibold">
          {tr("game_hub_overview", undefined, "Overview")}
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">{tr("game_hub_title_id", undefined, "Title ID")}</dt>
            <dd className="font-mono">{game.titleId}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">{tr("game_hub_name", undefined, "Name")}</dt>
            <dd className="truncate">{game.name}</dd>
          </div>
          {game.size > 0 && (
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">{tr("game_hub_size", undefined, "Size")}</dt>
              <dd>{formatBytes(game.size)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">{tr("game_hub_path", undefined, "Path")}</dt>
            <dd className="max-w-[300px] truncate font-mono text-xs" title={game.path}>
              {game.path || "—"}
            </dd>
          </div>
          {playSeconds !== undefined && playSeconds > 0 && (
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">{tr("game_hub_total_play_time", undefined, "Total play time")}</dt>
              <dd>{formatDuration(playSeconds)}</dd>
            </div>
          )}
          {lastSeenMs && (
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">{tr("game_hub_last_played", undefined, "Last played")}</dt>
              <dd>{new Date(lastSeenMs).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      </Card>
    </div>
  );
}

/** Storage tab — disk usage breakdown. */
function StorageTab({ game }: { game: GameInfo }) {
  const tr = useTr();
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">
        {tr("game_hub_storage", undefined, "Storage")}
      </h2>
      {game.size > 0 ? (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">{tr("game_hub_game_data", undefined, "Game data")}</dt>
            <dd>{formatBytes(game.size)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">{tr("game_hub_path", undefined, "Path")}</dt>
            <dd className="max-w-[300px] truncate font-mono text-xs" title={game.path}>
              {game.path || "—"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">
          {tr("game_hub_size_unavailable", undefined, "Size information unavailable.")}
        </p>
      )}
    </Card>
  );
}

/** Play time tab — aggregate stats. */
function PlayTimeTab({
  playSeconds,
  lastSeenMs,
}: {
  playSeconds: number | undefined;
  lastSeenMs: number | undefined;
}) {
  const tr = useTr();
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">
        {tr("game_hub_playtime", undefined, "Play Time")}
      </h2>
      {playSeconds !== undefined && playSeconds > 0 ? (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">{tr("game_hub_total", undefined, "Total")}</dt>
            <dd>{formatDuration(playSeconds)}</dd>
          </div>
          {lastSeenMs && (
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">{tr("game_hub_last_session", undefined, "Last session")}</dt>
              <dd>{new Date(lastSeenMs).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">
          {tr("game_hub_no_playtime", undefined, "No play time data recorded for this game.")}
        </p>
      )}
    </Card>
  );
}

/** Placeholder tab — for tabs not yet fully implemented. */
function PlaceholderTab({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Info;
  title: string;
  desc: string;
}) {
  const tr = useTr();
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon size={16} className="text-[var(--color-muted)]" />
        {title}
      </h2>
      <p className="text-sm text-[var(--color-muted)]">{desc}</p>
      <div className="mt-4 rounded-md border border-dashed border-[var(--color-border)] p-6 text-center">
        <span className="text-xs text-[var(--color-muted)]">
          {tr("game_hub_coming_soon", undefined, "Coming soon")}
        </span>
      </div>
    </Card>
  );
}

/** Tab label lookup. */
function tabLabel(
  id: TabId,
  tr: (key: string, vars?: Record<string, string | number>, fallback?: string) => string,
): string {
  switch (id) {
    case "overview":
      return tr("game_hub_overview", undefined, "Overview");
    case "cheats":
      return tr("game_hub_cheats", undefined, "Cheats");
    case "saves":
      return tr("game_hub_saves", undefined, "Saves");
    case "media":
      return tr("game_hub_media", undefined, "Media");
    case "addons":
      return tr("game_hub_addons", undefined, "Add-ons");
    case "updates":
      return tr("game_hub_updates", undefined, "Updates");
    case "storage":
      return tr("game_hub_storage", undefined, "Storage");
    case "playtime":
      return tr("game_hub_playtime", undefined, "Play Time");
    default:
      return id;
  }
}

/** Tab icon lookup. */
function tabIcon(id: TabId) {
  switch (id) {
    case "overview":
      return Info;
    case "cheats":
      return Shield;
    case "saves":
      return Save;
    case "media":
      return ImageIcon;
    case "addons":
      return Package;
    case "updates":
      return Download;
    case "storage":
      return HardDrive;
    case "playtime":
      return Clock;
    default:
      return Info;
  }
}
