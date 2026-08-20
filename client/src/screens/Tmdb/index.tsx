import { useCallback, useEffect, useState } from "react";
import { Database, Search, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { PageHeader, Button, ErrorCard, ConnectionGate, Card, Spinner, Checkbox } from "../../components";
import { useTr } from "../../state/lang";
import { useConnectionStore } from "../../state/connection";
import { transferAddr } from "../../lib/addr";
import { humanizePs5Error } from "../../lib/humanizeError";
import { normalizeTitleId } from "../../lib/titleId";
import {
  tmdbFetch,
  appsInstalled,
  type TmdbFetchResponse,
  type InstalledTitle,
} from "../../api/ps5";

export default function TmdbScreen() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const addr = host ? transferAddr(host) : "";

  const [titleId, setTitleId] = useState("");
  const [refresh, setRefresh] = useState(false);
  const [region, setRegion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TmdbFetchResponse | null>(null);
  /* Picking beats typing. Nobody knows their game's title id, and the old
   * screen opened with an empty box expecting one — so the first action
   * available was to get it wrong. We list what is actually installed and
   * let people click. Manual entry stays for the cases the list cannot
   * cover (a game not installed yet, or a specific region variant). */
  const [installed, setInstalled] = useState<InstalledTitle[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const loadInstalled = useCallback(async () => {
    if (!addr || payloadStatus !== "up") return;
    setLoadingList(true);
    try {
      const r = await appsInstalled(addr);
      setInstalled(r.titles.filter((t) => !t.system));
    } catch {
      /* Non-fatal — the manual box still works, so a failed listing
       * degrades to the old behaviour instead of blocking the screen. */
      setInstalled([]);
    } finally {
      setLoadingList(false);
    }
  }, [addr, payloadStatus]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  /* Takes an explicit id so a click can look up immediately instead of
   * waiting a render for setTitleId to land. */
  const handleFetch = useCallback(async (idOverride?: string) => {
    const id = (idOverride ?? titleId).trim();
    if (!addr || payloadStatus !== "up" || !id) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await tmdbFetch(
        // Installed-game listings report a bare title id (CUSA12345);
        // the lookup wants the full form. Expanding here means clicking
        // a game works even against a payload predating the fix.
        normalizeTitleId(id),
        refresh,
        addr,
        region.trim() || undefined,
      );
      setResult(resp);
      if (!resp.ok) {
        const msgs: Record<string, string> = {
          not_found: tr("tmdb_not_found", undefined, "No metadata found for that title on this console."),
          not_cached: tr("tmdb_not_cached", undefined, "Not cached yet — fetching from the console."),
          invalid_title_id: tr("tmdb_invalid_id", undefined, "Invalid format. Expected CUSA00001_00 or full content ID (UP9000-CUSA00001_00-LABEL)"),
        };
        setError(msgs[resp.error ?? ""] ?? humanizePs5Error(resp.error ?? "Unknown error"));
      }
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [addr, payloadStatus, titleId, refresh, region, tr]);

  return (
    <div className="p-6">
      <ConnectionGate>
        <PageHeader
          icon={Database}
          title={tr("tmdb_title", undefined, "Game Metadata")}
          description={tr(
            "tmdb_subtitle",
            undefined,
            "Look up a game's name and details, cached on the console",
          )}
        />

        {error && <div className="mb-4"><ErrorCard title={error} /></div>}

        {/* What this screen is FOR, in one line. It was previously
            unexplained, so the only way to learn was to try it. */}
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          {tr(
            "tmdb_explain",
            undefined,
            "Fetches a game's proper name and cover details from the PlayStation Store and caches them on the console. Useful when a game shows up as a bare ID or a blank tile.",
          )}
        </p>

        {/* Pick a game rather than typing an ID nobody memorises. */}
        <Card className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              {tr("tmdb_pick_game", undefined, "Pick a game")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void loadInstalled()}
              disabled={loadingList}
            >
              <RefreshCw size={14} className={loadingList ? "animate-spin" : ""} />
            </Button>
          </div>
          {loadingList && !installed ? (
            <Spinner />
          ) : installed && installed.length > 0 ? (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {installed.map((t) => (
                <button
                  key={t.titleId}
                  type="button"
                  onClick={() => {
                    setTitleId(t.titleId);
                    void handleFetch(t.titleId);
                  }}
                  className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface)] ${
                    titleId === t.titleId
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  <span className="truncate">{t.titleName || t.titleId}</span>
                  <span className="ml-2 shrink-0 font-mono text-xs text-[var(--color-muted)]">
                    {t.titleId}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              {tr(
                "tmdb_no_installed",
                undefined,
                "No games found on this console. You can still enter an ID by hand below.",
              )}
            </p>
          )}
          <button
            type="button"
            className="mt-3 text-xs text-[var(--color-muted)] underline"
            onClick={() => setShowManual((v) => !v)}
          >
            {showManual
              ? tr("tmdb_hide_manual", undefined, "Hide manual entry")
              : tr("tmdb_show_manual", undefined, "Enter an ID by hand instead")}
          </button>
        </Card>

        <Card className={showManual ? "mb-4" : "mb-4 hidden"}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="text"
              value={titleId}
              onChange={(e) => setTitleId(e.target.value.toUpperCase())}
              className="input flex-1 font-mono uppercase"
              placeholder={tr("tmdb_title_id_placeholder", "CUSA00001_00 or UP9000-CUSA00001_00-LABEL")}
              maxLength={36}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleFetch();
              }}
            />
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value.toUpperCase())}
              className="input w-28 font-mono uppercase"
              placeholder={tr("tmdb_region_placeholder", "Region")}
              maxLength={8}
              title={tr("tmdb_region_title", "Region prefix (e.g. UP9000 for US, EP1018 for EU). Leave empty to search all regions.")}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleFetch();
              }}
            />
            <Checkbox
              checked={refresh}
              onChange={(checked) => setRefresh(checked)}
              label={tr("tmdb_refresh", undefined, "Force refresh")}
              className="whitespace-nowrap text-sm"
            />
            <Button variant="primary" size="md" onClick={() => void handleFetch()} disabled={loading || !titleId.trim()}>
              {loading ? <Spinner size={16} tone="inherit" /> : <Search size={16} />}
              {tr("tmdb_fetch", undefined, "Fetch")}
            </Button>
          </div>
          <div className="mt-2 text-xs text-[var(--color-muted)]">
            {tr("tmdb_region_hint", "Region prefix (e.g. UP9000=US, EP1018=EU, JP9000=JP) speeds up lookup by trying only that region instead of all 24.")}
          </div>
        </Card>

        {result && (
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              {result.ok ? (
                <CheckCircle2 size={20} className="shrink-0 text-[var(--color-good)]" />
              ) : (
                <AlertTriangle size={20} className="shrink-0 text-[var(--color-warn)]" />
              )}
              <span className="min-w-0 flex-1 truncate font-semibold">
                {result.ok
                  ? (result.name ?? result.title_id ?? tr("tmdb_found", undefined, "Found"))
                  : (result.error ?? tr("tmdb_not_found", undefined, "Not found"))}
              </span>
              {result.ok && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setRefresh(true);
                    void handleFetch();
                  }}
                >
                  <RefreshCw size={14} />
                  {tr("refresh", undefined, "Refresh")}
                </Button>
              )}
            </div>

            {result.ok && (
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                {result.np_title_id && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)]">{tr("tmdb_field_np_title_id", "NP Title ID:")}</span>
                    <code className="font-mono">{result.np_title_id}</code>
                  </div>
                )}
                {result.content_id && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)]">{tr("tmdb_field_content_id", "Content ID:")}</span>
                    <code className="font-mono text-right">{result.content_id}</code>
                  </div>
                )}
                {result.category && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)]">{tr("tmdb_field_category", "Category:")}</span>
                    <span>{result.category}</span>
                  </div>
                )}
                {result.publisher && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)]">{tr("tmdb_field_publisher", "Publisher:")}</span>
                    <span>{result.publisher}</span>
                  </div>
                )}
                {result.release_date && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)]">{tr("tmdb_field_release_date", "Release Date:")}</span>
                    <span>{result.release_date}</span>
                  </div>
                )}
                {result.genre && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)]">{tr("tmdb_field_genre", "Genre:")}</span>
                    <span>{result.genre}</span>
                  </div>
                )}
                {result.sku && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-muted)]">{tr("tmdb_field_sku", "SKU:")}</span>
                    <code className="font-mono">{result.sku}</code>
                  </div>
                )}
                {result.icon && (
                  <div className="md:col-span-2">
                    <img src={result.icon} alt={tr("tmdb_icon_alt", "icon")} className="h-32 w-32 rounded-lg" />
                  </div>
                )}
                {result.description && (
                  <div className="md:col-span-2 text-[var(--color-muted)]">{result.description}</div>
                )}
              </div>
            )}
          </Card>
        )}
      </ConnectionGate>
    </div>
  );
}
