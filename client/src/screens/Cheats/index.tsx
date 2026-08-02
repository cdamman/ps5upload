import { useCallback, useEffect, useState } from "react";
import {
  Gamepad2,
  Loader2,
  RefreshCw,
  Power,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
  Zap,
  Download,
} from "lucide-react";
import {
  PageHeader,
  Button,
  ErrorCard,
  ConnectionGate,
  EmptyState,
  Card,
} from "../../components";
import { useTr } from "../../state/lang";
import { useConnectionStore } from "../../state/connection";
import { transferAddr } from "../../lib/addr";
import { humanizePs5Error } from "../../lib/humanizeError";
import {
  cheatsList,
  cheatsGet,
  cheatsToggle,
  cheatsDelete,
  cheatsReload,
  cheatsStatus,
  cheatsEngineSet,
  type CheatTitle,
  type CheatMod,
  type CheatsStatusResponse,
} from "../../api/ps5";
import { RepoBrowser } from "./RepoBrowser";

export default function CheatsScreen() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const addr = host ? transferAddr(host) : "";

  const [titles, setTitles] = useState<CheatTitle[]>([]);
  const [status, setStatus] = useState<CheatsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [mods, setMods] = useState<CheatMod[]>([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [modsError, setModsError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [showRepoBrowser, setShowRepoBrowser] = useState(false);

  const refresh = useCallback(async () => {
    if (!addr || payloadStatus !== "up") return;
    setLoading(true);
    setError(null);
    try {
      const [list, st] = await Promise.all([
        cheatsList(addr),
        cheatsStatus(addr).catch(() => null),
      ]);
      setTitles(list.titles ?? []);
      setStatus(st);
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [addr, payloadStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMods = useCallback(
    async (titleId: string) => {
      if (!addr) return;
      setSelectedTitle(titleId);
      setMods([]);
      setModsError(null);
      setModsLoading(true);
      try {
        const resp = await cheatsGet(titleId, addr);
        setMods(resp.mods ?? []);
        if (resp.error) setModsError(resp.error);
      } catch (e) {
        setModsError(humanizePs5Error(String(e)));
      } finally {
        setModsLoading(false);
      }
    },
    [addr],
  );

  const handleToggle = async (index: number, currentOn: boolean) => {
    if (!addr || !selectedTitle) return;
    setToggling(index);
    try {
      const resp = await cheatsToggle(selectedTitle, index, !currentOn, addr);
      if (!resp.ok) {
        setModsError(resp.err || "Toggle failed");
      } else {
        setMods((prev) =>
          prev.map((m) =>
            m.index === index ? { ...m, on: !currentOn } : m,
          ),
        );
        setModsError(null);
      }
    } catch (e) {
      setModsError(humanizePs5Error(String(e)));
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async () => {
    if (!addr || !selectedTitle) return;
    if (!confirm(`Delete all cheat files for ${selectedTitle}?`)) return;
    try {
      await cheatsDelete(selectedTitle, addr);
      setSelectedTitle(null);
      setMods([]);
      void refresh();
    } catch (e) {
      setModsError(humanizePs5Error(String(e)));
    }
  };

  const handleReload = async () => {
    if (!addr) return;
    try {
      await cheatsReload(addr);
      void refresh();
      if (selectedTitle) void loadMods(selectedTitle);
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    }
  };

  const handleEngineToggle = async () => {
    if (!addr || !status) return;
    try {
      const resp = await cheatsEngineSet(!status.enabled, addr);
      if (resp.ok) {
        setStatus((prev) =>
          prev ? { ...prev, enabled: resp.enabled } : prev,
        );
      }
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <PageHeader
        icon={Gamepad2}
        title={tr("cheats_title", undefined, "Cheats")}
        description={tr(
          "cheats_description",
          undefined,
          "Apply memory patches to running games. Supports JSON, SHN, and patch files.",
        )}
        right={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRepoBrowser(true)}
              disabled={payloadStatus !== "up" || !addr}
              title={tr("cheats_download_title", undefined, "Download Community Cheats")}
            >
              <Download size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReload}
              disabled={loading || payloadStatus !== "up" || !addr}
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </Button>
          </div>
        }
      />

      <ConnectionGate>
        {error && <ErrorCard title={error} />}

        {status && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <Power
                  size={18}
                  className={
                    status.enabled
                      ? "text-[var(--color-good)]"
                      : "text-[var(--color-muted)]"
                  }
                />
                <div>
                  <div className="text-sm font-medium">
                    {tr(
                      "cheats_engine",
                      undefined,
                      "Cheat Engine",
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {status.enabled ? "Enabled" : "Disabled"}
                    {status.game_running && (
                      <span className="ml-2 text-[var(--color-accent)]">
                        Game: {status.game_title_id || "unknown"} (PID:{" "}
                        {status.game_pid})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {status.patches_total > 0 && (
                  <span className="flex items-center gap-1 text-xs text-[var(--color-muted)]">
                    <Zap size={12} />
                    {status.patches_total} patches applied
                  </span>
                )}
                <Button
                  variant={status.enabled ? "primary" : "ghost"}
                  size="sm"
                  onClick={handleEngineToggle}
                >
                  {status.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Title list */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              {tr("cheats_titles", undefined, "Titles")}
            </h3>
            {titles.length === 0 && !loading ? (
              <EmptyState
                icon={Gamepad2}
                title={tr(
                  "cheats_no_titles",
                  undefined,
                  "No cheat files",
                )}
                message={tr(
                  "cheats_no_titles_hint",
                  undefined,
                  "Upload cheat files to /data/ps5upload/cheats/ on the PS5",
                )}
              />
            ) : (
              <div className="space-y-1">
                {titles.map((t) => (
                  <button
                    key={t.title_id}
                    onClick={() => void loadMods(t.title_id)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedTitle === t.title_id
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)]/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {t.name || t.title_id}
                      </div>
                      <div className="font-mono text-xs text-[var(--color-muted)]">
                        {t.title_id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.running && (
                        <span className="flex items-center gap-1 text-xs text-[var(--color-good)]">
                          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-good)]" />
                        </span>
                      )}
                      <ChevronRight size={14} className="text-[var(--color-muted)]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mod list */}
          <div className="space-y-2">
            {!selectedTitle ? (
              <EmptyState
                icon={ToggleLeft}
                title={tr(
                  "cheats_select_title",
                  undefined,
                  "Select a title",
                )}
                message={tr(
                  "cheats_select_title_hint",
                  undefined,
                  "Choose a game from the list to view available cheats",
                )}
              />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    {tr("cheats_mods", undefined, "Mods")} — {selectedTitle}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                {modsError && <ErrorCard title={modsError} />}
                {modsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-[var(--color-muted)]" />
                  </div>
                ) : mods.length === 0 ? (
                  <EmptyState
                    icon={ToggleLeft}
                    title={tr(
                      "cheats_no_mods",
                      undefined,
                      "No mods found",
                    )}
                    message={tr(
                      "cheats_no_mods_hint",
                      undefined,
                      "This title has no cheat file or it is empty",
                    )}
                  />
                ) : (
                  <div className="space-y-2">
                    {mods.map((m) => (
                      <div
                        key={m.index}
                        className={`rounded-md border px-3 py-2.5 ${
                          m.on
                            ? "border-[var(--color-good)]/40 bg-[var(--color-good-soft)]"
                            : "border-[var(--color-border)] bg-[var(--color-surface-2)]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">
                              {m.name || `Mod #${m.index}`}
                            </div>
                            {m.desc && (
                              <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                                {m.desc}
                              </div>
                            )}
                            <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                              <span className="font-mono">{m.type}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => void handleToggle(m.index, m.on)}
                            disabled={toggling === m.index}
                            className="flex-shrink-0"
                          >
                            {toggling === m.index ? (
                              <Loader2 size={20} className="animate-spin" />
                            ) : m.on ? (
                              <ToggleRight
                                size={24}
                                className="text-[var(--color-good)]"
                              />
                            ) : (
                              <ToggleLeft
                                size={24}
                                className="text-[var(--color-muted)]"
                              />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </ConnectionGate>

      {showRepoBrowser && addr && (
        <RepoBrowser
          addr={addr}
          onDownloaded={() => void refresh()}
          onClose={() => setShowRepoBrowser(false)}
        />
      )}
    </div>
  );
}
