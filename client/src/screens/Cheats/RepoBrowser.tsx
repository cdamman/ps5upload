import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Loader2,
  Download,
  X,
  CheckCircle2,
  ExternalLink,
  Package,
} from "lucide-react";
import { Button, ErrorCard, Card } from "../../components";
import { useTr } from "../../state/lang";
import {
  cheatsReposList,
  cheatsReposSearch,
  cheatsReposDownload,
  type CheatRepo,
  type CheatRepoEntry,
} from "../../api/ps5";
import { humanizePs5Error } from "../../lib/humanizeError";

interface RepoBrowserProps {
  addr: string;
  onDownloaded: () => void;
  onClose: () => void;
}

export function RepoBrowser({ addr, onDownloaded, onClose }: RepoBrowserProps) {
  const tr = useTr();
  const [repos, setRepos] = useState<CheatRepo[]>([]);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<CheatRepoEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await cheatsReposList();
        setRepos(r);
      } catch (e) {
        setError(humanizePs5Error(String(e)));
      }
    })();
  }, []);

  const handleSearch = useCallback(async () => {
    setSearching(true);
    setError(null);
    setDownloadError(null);
    try {
      const r = await cheatsReposSearch(query);
      setEntries(r.entries ?? []);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleDownload = async (entry: CheatRepoEntry) => {
    setDownloading(entry.filename);
    setDownloadError(null);
    try {
      const titleId = entry.filename.split(/[._]/)[0] || entry.filename;
      const r = await cheatsReposDownload(
        "etahen",
        entry.filename,
        titleId,
        addr,
      );
      if (r.ok) {
        setDownloaded((prev) => new Set(prev).add(entry.filename));
        onDownloaded();
      } else {
        setDownloadError(r.error || "Download failed");
      }
    } catch (e) {
      setDownloadError(humanizePs5Error(String(e)));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Package size={18} />
            <h2 className="text-sm font-semibold">
              {tr(
                "cheats_download_title",
                undefined,
                "Download Community Cheats",
              )}
            </h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {repos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {repos.map((r) => (
                <a
                  key={r.id}
                  href={`https://github.com/${r.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="badge flex items-center gap-1 hover:border-[var(--color-accent)]"
                >
                  <ExternalLink size={10} />
                  {r.name}
                </a>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
              placeholder={tr(
                "cheats_search_placeholder",
                undefined,
                "Search by game name or CUSA ID...",
              )}
              className="input flex-1"
              autoFocus
            />
            <Button
              onClick={handleSearch}
              disabled={searching}
              size="sm"
            >
              {searching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
            </Button>
          </div>

          {error && <ErrorCard title={error} />}
          {downloadError && <ErrorCard title={downloadError} />}

          {entries.length > 0 && (
            <div className="space-y-1.5">
              {entries.map((e) => (
                <Card key={e.filename}>
                  <div className="flex items-center justify-between gap-3 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {e.game_title}
                      </div>
                      <div className="truncate font-mono text-xs text-[var(--color-muted)]">
                        {e.filename}
                      </div>
                      <span className="badge mt-1 inline-block text-[10px]">
                        {e.format}
                      </span>
                    </div>
                    {downloaded.has(e.filename) ? (
                      <CheckCircle2
                        size={20}
                        className="flex-shrink-0 text-[var(--color-good)]"
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDownload(e)}
                        disabled={downloading === e.filename}
                      >
                        {downloading === e.filename ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Download size={14} />
                        )}
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {!searching && entries.length === 0 && !error && (
            <div className="py-8 text-center text-sm text-[var(--color-muted)]">
              {tr(
                "cheats_search_hint",
                undefined,
                "Enter a game name or title ID (e.g. CUSA00001) and press Search",
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
