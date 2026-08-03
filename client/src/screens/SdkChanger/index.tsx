import { useCallback, useEffect, useState } from "react";
import { Layers, RefreshCw, Wrench, AlertTriangle, CheckCircle2, Undo2 } from "lucide-react";
import { PageHeader, Button, ErrorCard, ConnectionGate, EmptyState, Card, Spinner } from "../../components";
import { useTr } from "../../state/lang";
import { useConnectionStore } from "../../state/connection";
import { transferAddr } from "../../lib/addr";
import { humanizePs5Error } from "../../lib/humanizeError";
import { sdkScan, sdkPatch, sdkRestore, type SdkTitle } from "../../api/ps5";

export default function SdkChangerScreen() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const addr = host ? transferAddr(host) : "";

  const [titles, setTitles] = useState<SdkTitle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patchTitleId, setPatchTitleId] = useState<string | null>(null);
  const [targetSdk, setTargetSdk] = useState("0x09060000");
  const [patching, setPatching] = useState(false);
  const [patchResult, setPatchResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [restoreTitleId, setRestoreTitleId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!addr || payloadStatus !== "up") return;
    setLoading(true);
    setError(null);
    try {
      const resp = await sdkScan(addr);
      setTitles(resp.titles ?? []);
    } catch (e) {
      setError(humanizePs5Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [addr, payloadStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePatch = async (titleId: string) => {
    if (!addr) return;
    setPatching(true);
    setPatchResult(null);
    try {
      const resp = await sdkPatch(titleId, targetSdk, addr);
      if (resp.ok) {
        setPatchResult({
          ok: true,
          msg: tr("sdk_patch_ok", undefined, `Patched ${titleId} → ${targetSdk}`),
        });
      } else {
        setPatchResult({ ok: false, msg: resp.error ?? "Patch failed" });
      }
    } catch (e) {
      setPatchResult({ ok: false, msg: humanizePs5Error(String(e)) });
    } finally {
      setPatching(false);
      setPatchTitleId(null);
    }
  };

  const handleRestore = async (titleId: string) => {
    if (!addr) return;
    setRestoreTitleId(titleId);
    setPatchResult(null);
    try {
      const resp = await sdkRestore(titleId, addr);
      if (resp.ok) {
        const count = resp.restored ?? 0;
        if (count > 0) {
          setPatchResult({
            ok: true,
            msg: tr(
              "sdk_restore_ok",
              { count: String(count), titleId },
              `Restored ${count} file(s) for ${titleId} from backup.`,
            ),
          });
        } else {
          setPatchResult({
            ok: false,
            msg: tr(
              "sdk_restore_no_backup",
              { titleId },
              `No backup files found for ${titleId}.`,
            ),
          });
        }
      } else {
        setPatchResult({ ok: false, msg: resp.error ?? "Restore failed" });
      }
    } catch (e) {
      setPatchResult({ ok: false, msg: humanizePs5Error(String(e)) });
    } finally {
      setRestoreTitleId(null);
    }
  };

  return (
    <div className="p-6">
      <ConnectionGate>
        <PageHeader
          icon={Layers}
          title={tr("sdk_changer_title", undefined, "SDK Version Changer")}
          description={tr(
            "sdk_changer_subtitle",
            undefined,
            "Scan and patch SDK/firmware version in installed titles",
          )}
          right={
            <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Spinner size={16} tone="inherit" /> : <RefreshCw size={16} />}
              {tr("refresh", undefined, "Refresh")}
            </Button>
          }
        />

        {error && <div className="mb-4"><ErrorCard title={error} /></div>}

        {patchResult && (
          <Card
            className={`mb-4 flex items-center gap-3 ${
              patchResult.ok
                ? "border-[var(--color-good)]/30 bg-[var(--color-good)]/5"
                : "border-[var(--color-bad)]/30 bg-[var(--color-bad)]/5"
            }`}
          >
            {patchResult.ok ? (
              <CheckCircle2 size={20} className="text-[var(--color-good)]" />
            ) : (
              <AlertTriangle size={20} className="text-[var(--color-bad)]" />
            )}
            <span className={patchResult.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}>
              {patchResult.msg}
            </span>
          </Card>
        )}

        <Card className="mb-4 border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
            <div className="text-sm">
              <strong>{tr("sdk_warning", undefined, "Warning:")}</strong>{" "}
              {tr(
                "sdk_warning_text",
                undefined,
                "SDK patching modifies game binaries and param.json files in-place. Original files are backed up with a .bak suffix. Use at your own risk.",
              )}
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : titles.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={tr("sdk_no_titles", undefined, "No titles found")}
            message={tr(
              "sdk_no_titles_desc",
              undefined,
              "No installed apps detected in /user/appmeta",
            )}
          />
        ) : (
          <div className="space-y-2">
            {titles.map((t) => (
              <Card key={t.title_id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-semibold">{t.title_id}</div>
                    {t.name && <div className="text-sm text-[var(--color-muted)]">{t.name}</div>}
                    <div className="mt-1 flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
                      <span>
                        {tr("sdk_sdk", undefined, "SDK")}:{" "}
                        <code className="font-mono">{t.sdk_version || "—"}</code>
                      </span>
                      <span>
                        {tr("sdk_fw", undefined, "FW")}:{" "}
                        <code className="font-mono">{t.fw_required || "—"}</code>
                      </span>
                    </div>
                  </div>
                  {patchTitleId === t.title_id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={targetSdk}
                        onChange={(e) => setTargetSdk(e.target.value)}
                        className="input input-sm w-40 font-mono"
                        placeholder="0x09060000"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handlePatch(t.title_id)}
                        disabled={patching}
                      >
                        {patching ? (
                          <Spinner size={14} tone="inherit" />
                        ) : (
                          tr("sdk_confirm", undefined, "Confirm")
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPatchTitleId(null)}
                      >
                        {tr("cancel", undefined, "Cancel")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPatchTitleId(t.title_id);
                          setPatchResult(null);
                        }}
                      >
                        <Wrench size={14} /> {tr("sdk_patch", undefined, "Patch")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRestore(t.title_id)}
                        disabled={restoreTitleId !== null}
                        title={tr("sdk_restore_tooltip", undefined, "Restore original files from .bak backups")}
                      >
                        {restoreTitleId === t.title_id ? (
                          <Spinner size={14} tone="inherit" />
                        ) : (
                          <Undo2 size={14} />
                        )}
                        {tr("sdk_restore", undefined, "Restore")}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </ConnectionGate>
    </div>
  );
}
