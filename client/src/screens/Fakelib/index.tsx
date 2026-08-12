import { useCallback, useEffect, useState } from "react";
import { Boxes, RefreshCw, Upload, FileCog, AlertTriangle } from "lucide-react";
import {
  PageHeader,
  Button,
  Card,
  ErrorCard,
  ConnectionGate,
  EmptyState,
  Spinner,
} from "../../components";
import { useTr } from "../../state/lang";
import { useConnectionStore } from "../../state/connection";
import { transferAddr } from "../../lib/addr";
import { humanizePs5Error } from "../../lib/humanizeError";
import { pickPath } from "../../lib/pickPath";
import {
  appsInstalled,
  fsListDir,
  startTransferFile,
  waitForJob,
  bpsInspect,
  bpsApply,
  saveArchiveMakeTemp,
  saveArchiveCleanupTemp,
  type InstalledTitle,
  type FsDirEntry,
} from "../../api/ps5";
import { joinDir } from "../../lib/screenshotConvert";

/**
 * Fakelib manager — the runtime half of backporting a game.
 *
 * A game built for newer firmware needs that firmware's system
 * libraries. BackPork union-mounts a `fakelib` folder from the game's
 * install directory over the sandbox's `common/lib` at launch, so the
 * game loads the replacements without the originals being touched. This
 * screen puts libraries into that folder, optionally applying a BPS
 * patch on the way (those patches strip imports the older firmware does
 * not have).
 *
 * Only folder-installed titles can have one: an image-backed title lives
 * on a read-only mount, so there is nowhere to create `fakelib`.
 */
export default function FakelibScreen() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const addr = host ? transferAddr(host) : "";

  const [titles, setTitles] = useState<InstalledTitle[]>([]);
  const [selected, setSelected] = useState<InstalledTitle | null>(null);
  const [contents, setContents] = useState<FsDirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [patchPath, setPatchPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!addr || payloadStatus !== "up") return;
    setLoading(true);
    setError(null);
    try {
      const res = await appsInstalled(addr);
      // Only folder installs; an image-backed title's files live on a
      // read-only mount where fakelib cannot be created.
      setTitles(
        res.titles.filter((t) => !t.system && !t.imageBacked && t.source),
      );
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [addr, payloadStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadContents = useCallback(
    async (t: InstalledTitle) => {
      setSelected(t);
      setContents([]);
      setStatus(null);
      try {
        setContents(await fsListDir(addr, `${t.source}/fakelib`));
      } catch {
        // No fakelib yet is the normal starting state, not an error.
        setContents([]);
      }
    },
    [addr],
  );

  const addLibrary = async () => {
    if (!selected) return;
    const src = await pickPath({
      mode: "file",
      title: tr("fakelib_pick_lib", undefined, "Choose a library (.sprx / .prx)"),
      filters: [{ name: "PS5 library", extensions: ["sprx", "prx", "elf"] }],
    });
    if (!src) return;

    setBusy(true);
    setError(null);
    setStatus(null);
    let tempDir: string | null = null;
    try {
      let upload = src;
      const name = src.split(/[/\\]/).pop() ?? "library.sprx";

      if (patchPath) {
        // Patch first. A mismatched source is rejected here rather than
        // producing a library that only fails at game launch.
        tempDir = await saveArchiveMakeTemp("fakelib-bps");
        const dest = joinDir(tempDir, name);
        setStatus(tr("fakelib_patching", undefined, "Applying patch…"));
        const res = await bpsApply(src, patchPath, dest);
        upload = res.dest;
      }

      // startTransferFile only enqueues the job — without waitForJob the
      // UI claimed "Added" and re-listed the folder while the transfer
      // was still in flight (or already failed).
      setStatus(tr("fakelib_uploading", undefined, "Uploading…"));
      const jobId = await startTransferFile(
        upload,
        `${selected.source}/fakelib/${name}`,
        addr,
      );
      await waitForJob(jobId);
      setStatus(tr("fakelib_added", undefined, `Added ${name}`));
      await loadContents(selected);
    } catch (e) {
      setError(humanizePs5Error(String(e)));
      setStatus(null);
    } finally {
      if (tempDir) await saveArchiveCleanupTemp(tempDir).catch(() => {});
      setBusy(false);
    }
  };

  const choosePatch = async () => {
    const p = await pickPath({
      mode: "file",
      title: tr("fakelib_pick_patch", undefined, "Choose a .bps patch"),
      filters: [{ name: "BPS patch", extensions: ["bps"] }],
    });
    if (!p) return;
    try {
      const info = await bpsInspect(p);
      setPatchPath(p);
      setStatus(
        tr(
          "fakelib_patch_ready",
          undefined,
          `Patch expects a ${info.source_size.toLocaleString()}-byte library`,
        ),
      );
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    }
  };

  return (
    <div className="p-6">
      <ConnectionGate>
        <PageHeader
          icon={Boxes}
          title={tr("fakelib_title", undefined, "Fakelib (backport libraries)")}
          description={tr(
            "fakelib_subtitle",
            undefined,
            "Give a game the newer system libraries it needs to run on your firmware",
          )}
          right={
            <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Spinner size={16} tone="inherit" /> : <RefreshCw size={16} />}
              {tr("refresh", undefined, "Refresh")}
            </Button>
          }
        />

        {error && (
          <div className="mb-4">
            <ErrorCard title={error} />
          </div>
        )}

        <Card className="mb-4">
          <div className="text-sm leading-relaxed">
            <p className="mb-2">
              {tr(
                "fakelib_explain",
                undefined,
                "A game built for newer firmware needs that firmware's system libraries. Put them here and BackPork mounts them into the game when it launches, leaving the originals untouched. Run the BackPork payload from the Payloads screen for this to take effect.",
              )}
            </p>
            <p>
              {tr(
                "fakelib_explain_pair",
                undefined,
                "This is the second half of a backport — the game's own files also need their required firmware lowered, on the SDK Version Changer screen. Libraries usually need a BPS patch first to remove functions your firmware does not have.",
              )}
            </p>
          </div>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : titles.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={tr("fakelib_no_titles", undefined, "No folder-installed games")}
            message={tr(
              "fakelib_no_titles_desc",
              undefined,
              "Only games installed as a folder can take replacement libraries. Titles mounted from a disk image are read-only.",
            )}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-2 text-sm font-semibold">
                {tr("fakelib_pick_title", undefined, "Game")}
              </div>
              <div className="space-y-1">
                {titles.map((t) => (
                  <button
                    key={t.titleId}
                    onClick={() => void loadContents(t)}
                    className={`w-full rounded px-3 py-2 text-left text-sm ${
                      selected?.titleId === t.titleId
                        ? "bg-[var(--color-accent)]/10"
                        : "hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    <div className="font-medium">{t.titleName || t.titleId}</div>
                    <div className="font-mono text-xs text-[var(--color-muted)]">
                      {t.titleId}
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              {!selected ? (
                <div className="py-8 text-center text-sm text-[var(--color-muted)]">
                  {tr("fakelib_select", undefined, "Select a game")}
                </div>
              ) : (
                <>
                  <div className="mb-3 text-sm font-semibold">
                    {selected.titleName || selected.titleId}
                  </div>
                  <div className="mb-3 font-mono text-xs break-all text-[var(--color-muted)]">
                    {selected.source}/fakelib
                  </div>

                  {contents.length === 0 ? (
                    <div className="mb-3 text-sm text-[var(--color-muted)]">
                      {tr("fakelib_empty", undefined, "No libraries added yet.")}
                    </div>
                  ) : (
                    <ul className="mb-3 space-y-1 text-sm">
                      {contents.map((c) => (
                        <li key={c.name} className="font-mono text-xs">
                          {c.name}
                        </li>
                      ))}
                    </ul>
                  )}

                  {patchPath && (
                    <div className="mb-2 flex items-start gap-2 rounded border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-2 text-xs">
                      <AlertTriangle
                        size={14}
                        className="mt-0.5 shrink-0 text-[var(--color-warn)]"
                      />
                      <span className="break-all">
                        {tr("fakelib_patch_active", undefined, "Patch will be applied:")}{" "}
                        <span className="font-mono">{patchPath.split(/[/\\]/).pop()}</span>
                      </span>
                    </div>
                  )}

                  {status && (
                    <div className="mb-2 text-xs text-[var(--color-muted)]">{status}</div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void addLibrary()}
                      disabled={busy}
                    >
                      {busy ? <Spinner size={14} tone="inherit" /> : <Upload size={14} />}
                      {tr("fakelib_add", undefined, "Add library")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void choosePatch()}
                      disabled={busy}
                    >
                      <FileCog size={14} />
                      {patchPath
                        ? tr("fakelib_change_patch", undefined, "Change patch")
                        : tr("fakelib_choose_patch", undefined, "Choose .bps patch")}
                    </Button>
                    {patchPath && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPatchPath(null);
                          setStatus(null);
                        }}
                        disabled={busy}
                      >
                        {tr("fakelib_clear_patch", undefined, "No patch")}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          </div>
        )}
      </ConnectionGate>
    </div>
  );
}
