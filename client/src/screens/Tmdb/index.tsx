import { useCallback, useState } from "react";
import { Database, Search, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { PageHeader, Button, ErrorCard, ConnectionGate, Card, Spinner } from "../../components";
import { useTr } from "../../state/lang";
import { useConnectionStore } from "../../state/connection";
import { transferAddr } from "../../lib/addr";
import { humanizePs5Error } from "../../lib/humanizeError";
import { tmdbFetch, type TmdbFetchResponse } from "../../api/ps5";

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

  const handleFetch = useCallback(async () => {
    if (!addr || payloadStatus !== "up" || !titleId.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await tmdbFetch(
        titleId.trim().toUpperCase(),
        refresh,
        addr,
        region.trim() || undefined,
      );
      setResult(resp);
      if (!resp.ok) {
        const msgs: Record<string, string> = {
          not_found: tr("tmdb_not_found", undefined, "Title not found on PlayStation Store."),
          not_cached: tr("tmdb_not_cached", undefined, "No cached metadata on PS5."),
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
          title={tr("tmdb_title", undefined, "TMDB Metadata")}
          description={tr(
            "tmdb_subtitle",
            undefined,
            "Fetch PlayStation Store title metadata from the PS5 cache",
          )}
        />

        {error && <div className="mb-4"><ErrorCard title={error} /></div>}

        <Card className="mb-4">
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
            <label className="flex items-center gap-2 text-sm whitespace-nowrap">
              <input
                type="checkbox"
                checked={refresh}
                onChange={(e) => setRefresh(e.target.checked)}
                className="checkbox"
              />
              {tr("tmdb_refresh", undefined, "Force refresh")}
            </label>
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
