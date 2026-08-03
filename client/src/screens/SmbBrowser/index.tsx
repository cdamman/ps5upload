import { useCallback, useState } from "react";
import {
  Network,
  Folder,
  File,
  ChevronLeft,
  RefreshCw,
  HardDrive,
  Download,
  Home,
} from "lucide-react";
import { PageHeader, Button, ErrorCard, ConnectionGate, Card, EmptyState, Spinner } from "../../components";
import { useTr } from "../../state/lang";
import { humanizePs5Error } from "../../lib/humanizeError";
import {
  smbListShares,
  smbListDir,
  smbDownloadFile,
  type SmbShare,
  type SmbDirEntry,
} from "../../api/ps5";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function SmbBrowserScreen() {
  const tr = useTr();

  const [server, setServer] = useState("smb://192.168.1.100:445");
  const [user, setUser] = useState("guest");
  const [password, setPassword] = useState("");
  const [connected, setConnected] = useState(false);
  const [shares, setShares] = useState<SmbShare[]>([]);
  const [currentShare, setCurrentShare] = useState<string | null>(null);
  const [entries, setEntries] = useState<SmbDirEntry[]>([]);
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShares([]);
    setEntries([]);
    setConnected(false);
    setCurrentShare(null);
    try {
      const resp = await smbListShares(server, user, password);
      setShares(resp.shares ?? []);
      setConnected(true);
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [server, user, password]);

  const browseShare = useCallback(
    async (shareName: string) => {
      setLoading(true);
      setError(null);
      setPathStack([]);
      try {
        const resp = await smbListDir(server, user, shareName, "", password);
        setEntries(resp.entries ?? []);
        setCurrentShare(shareName);
      } catch (e) {
        setError(humanizePs5Error(String(e)));
      } finally {
        setLoading(false);
      }
    },
    [server, user, password],
  );

  const browseDir = useCallback(
    async (dirName: string) => {
      if (!currentShare) return;
      const newPathStack = [...pathStack, dirName];
      setLoading(true);
      setError(null);
      try {
        const path = newPathStack.join("/");
        const resp = await smbListDir(server, user, currentShare, path, password);
        setEntries(resp.entries ?? []);
        setPathStack(newPathStack);
      } catch (e) {
        setError(humanizePs5Error(String(e)));
      } finally {
        setLoading(false);
      }
    },
    [currentShare, pathStack, server, user, password],
  );

  const navigateTo = useCallback(
    async (depth: number) => {
      if (!currentShare) return;
      const newPathStack = pathStack.slice(0, depth);
      setLoading(true);
      setError(null);
      try {
        const path = newPathStack.join("/");
        const resp = await smbListDir(server, user, currentShare, path, password);
        setEntries(resp.entries ?? []);
        setPathStack(newPathStack);
      } catch (e) {
        setError(humanizePs5Error(String(e)));
      } finally {
        setLoading(false);
      }
    },
    [currentShare, pathStack, server, user, password],
  );

  const goUp = useCallback(async () => {
    if (!currentShare || pathStack.length === 0) return;
    const newPathStack = pathStack.slice(0, -1);
    setLoading(true);
    setError(null);
    try {
      const path = newPathStack.join("/");
      const resp = await smbListDir(server, user, currentShare, path, password);
      setEntries(resp.entries ?? []);
      setPathStack(newPathStack);
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [currentShare, pathStack, server, user, password]);

  const handleDownload = useCallback(
    async (fileName: string) => {
      if (!currentShare) return;
      const fullPath = [...pathStack, fileName].join("/");
      const { save } = await import("@tauri-apps/plugin-dialog");
      const destPath = await save({
        defaultPath: fileName,
      });
      if (!destPath || typeof destPath !== "string") return;
      setDownloading(fileName);
      setError(null);
      try {
        await smbDownloadFile(server, user, currentShare, fullPath, destPath, password);
      } catch (e) {
        setError(humanizePs5Error(String(e)));
      } finally {
        setDownloading(null);
      }
    },
    [currentShare, pathStack, server, user, password],
  );

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="p-6">
      <ConnectionGate>
        <PageHeader
          icon={Network}
          title={tr("smb_title", undefined, "SMB Browser")}
          description={tr(
            "smb_subtitle",
            undefined,
            "Browse and download from SMB2/3 shares (Windows, Samba, NAS)",
          )}
        />

        {error && <div className="mb-4"><ErrorCard title={error} /></div>}

        {/* Connection form */}
        {!connected && (
          <Card className="mb-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="space-y-1 md:col-span-1">
                <span className="text-sm text-[var(--color-muted)]">
                  {tr("smb_server", undefined, "Server")}
                </span>
                <input
                  type="text"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className="input font-mono"
                  placeholder="192.168.1.100:445"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-[var(--color-muted)]">
                  {tr("smb_user", undefined, "Username")}
                </span>
                <input
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className="input"
                  placeholder={tr("smb_user_placeholder", "guest")}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-[var(--color-muted)]">
                  {tr("smb_password", undefined, "Password")}
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                />
              </label>
            </div>
            <Button variant="primary" size="md" onClick={() => void handleConnect()} disabled={loading}>
                {loading ? <Spinner size={16} tone="inherit" /> : <Network size={16} />}
              {tr("smb_connect", undefined, "Connect")}
            </Button>
          </Card>
        )}

        {/* Connected: show shares or directory listing */}
        {connected && (
          <>
            <Card className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <HardDrive size={16} className="shrink-0 text-[var(--color-muted)]" />
                <span className="font-mono">{server}</span>
                <span className="text-[var(--color-muted)]">·</span>
                <span>{user}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {currentShare && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void goUp()}
                      disabled={loading || pathStack.length === 0}
                    >
                      <ChevronLeft size={14} />
                      {tr("smb_up", undefined, "Up")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void browseShare(currentShare)}
                      disabled={loading}
                    >
                      <RefreshCw size={14} />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConnected(false);
                    setShares([]);
                    setEntries([]);
                    setCurrentShare(null);
                  }}
                >
                  {tr("smb_disconnect", undefined, "Disconnect")}
                </Button>
              </div>
            </Card>

            {/* Breadcrumb navigation */}
            {currentShare && (
              <Card className="mb-4 flex items-center gap-1 overflow-x-auto text-sm">
                <button
                  className="flex shrink-0 items-center gap-1 rounded px-2 py-1 font-mono font-semibold hover:bg-[var(--color-surface-3)]"
                  onClick={() => void navigateTo(0)}
                >
                  <Home size={14} />
                  {currentShare}
                </button>
                {pathStack.map((dir, i) => (
                  <div key={i} className="flex shrink-0 items-center gap-1">
                    <span className="text-[var(--color-muted)]">/</span>
                    <button
                      className="rounded px-2 py-1 font-mono hover:bg-[var(--color-surface-3)]"
                      onClick={() => void navigateTo(i + 1)}
                    >
                      {dir}
                    </button>
                  </div>
                ))}
              </Card>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner size={32} />
              </div>
            ) : !currentShare ? (
              shares.length === 0 ? (
                <EmptyState
                  icon={Network}
                  title={tr("smb_no_shares", undefined, "No shares found")}
                  message={tr("smb_no_shares_desc", undefined, "The server has no accessible shares")}
                />
              ) : (
                <div className="space-y-2">
                  {shares.map((s) => (
                    <div
                      key={s.name}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 transition-colors hover:bg-[var(--color-surface-3)]"
                      onClick={() => void browseShare(s.name)}
                    >
                      <HardDrive size={20} className="shrink-0 text-[var(--color-muted)]" />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold">{s.name}</div>
                        {s.comment && (
                          <div className="text-sm text-[var(--color-muted)]">{s.comment}</div>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-[var(--color-muted)]">{s.share_type}</span>
                    </div>
                  ))}
                </div>
              )
            ) : entries.length === 0 ? (
              <EmptyState
                icon={Folder}
                title={tr("smb_empty", undefined, "Empty directory")}
                message={tr("smb_empty_desc", undefined, "This folder contains no files")}
              />
            ) : (
              <div className="space-y-1">
                {sortedEntries.map((e) => (
                  <div
                    key={e.name}
                    className={`flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 transition-colors ${
                      e.is_dir ? "cursor-pointer hover:bg-[var(--color-surface-3)]" : ""
                    }`}
                    onClick={() => {
                      if (e.is_dir) void browseDir(e.name);
                    }}
                  >
                    {e.is_dir ? (
                      <Folder size={18} className="shrink-0 text-[var(--color-accent)]" />
                    ) : (
                      <File size={18} className="shrink-0 text-[var(--color-muted)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{e.name}</span>
                    {!e.is_dir && (
                      <span className="shrink-0 text-xs text-[var(--color-muted)]">
                        {formatSize(e.size)}
                      </span>
                    )}
                    {!e.is_dir && (
                      <button
                        className="shrink-0 rounded p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void handleDownload(e.name);
                        }}
                        disabled={downloading === e.name}
                        title={tr("smb_download", undefined, "Download")}
                      >
                        {downloading === e.name ? (
                          <Spinner size={14} tone="inherit" />
                        ) : (
                          <Download size={14} />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </ConnectionGate>
    </div>
  );
}
