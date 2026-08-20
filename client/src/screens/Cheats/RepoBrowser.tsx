import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Download,
  X,
  CheckCircle2,
  ExternalLink,
  Package,
} from "lucide-react";
import { Button, ErrorCard, Card, Spinner } from "../../components";
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


/** What to show as the row's name.
 *
 *  Not every source publishes game titles. One of the built-in sources
 *  has no index file at all and is enumerated by listing the repository,
 *  which yields filenames but no titles -- so `game_title` is empty for
 *  those rows. Falling through to the raw entry would render a blank
 *  line, so derive the title id from the filename instead: it is what
 *  the user searched by, and a title id beats nothing. */
function displayTitle(e: { game_title: string; filename: string }): string {
  const t = e.game_title.trim();
  if (t) return t;
  const id = e.filename.match(/^([A-Za-z]{4}\d{5})/);
  return id ? id[1] : e.filename;
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
      <div className="flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
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
              leftIcon={
                searching ? (
                  <Spinner size={14} tone="inherit" />
                ) : (
                  <Search size={14} />
                )
              }
            >
              {tr("cheats_search_action", undefined, "Search")}
            </Button>
          </div>

          {error && <ErrorCard title={error} />}
          {downloadError && <ErrorCard title={downloadError} />}

          {entries.length > 0 && (
            <div className="space-y-1.5">
              {entries.map((e) => (
                <Card key={e.filename}>
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {displayTitle(e)}
                      </div>
                      <div className="truncate font-mono text-xs text-[var(--color-muted)]">
                        {e.filename}
                      </div>
                      <span className="badge mt-1 inline-block text-xs uppercase">
                        {e.format}
                      </span>
                    </div>
                    {downloaded.has(e.filename) ? (
                      <span className="flex flex-shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--color-good)]">
                        <CheckCircle2 size={16} />
                        {tr("cheats_installed", undefined, "Installed")}
                      </span>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-shrink-0"
                        onClick={() => void handleDownload(e)}
                        disabled={downloading === e.filename}
                        leftIcon={
                          downloading === e.filename ? (
                            <Spinner size={14} tone="inherit" />
                          ) : (
                            <Download size={14} />
                          )
                        }
                      >
                        {downloading === e.filename
                          ? tr("cheats_installing", undefined, "Installing\u2026")
                          : tr("cheats_install", undefined, "Install")}
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
