import { useCallback, useEffect, useState } from "react";
import { HardDrive, FolderOpen, Eject, Info } from "lucide-react";
import {
  PageHeader,
  Button,
  Card,
  ErrorCard,
  Callout,
  EmptyState,
  Spinner,
} from "../../components";
import { useTr } from "../../state/lang";
import { pickPath } from "../../lib/pickPath";
import { openExternalUrl } from "../../lib/openExternalUrl";
import {
  localImageAttach,
  localImageDetach,
  localImageStatus,
  type AttachedImage,
  type LocalImageStatus,
} from "../../api/ps5";

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export default function LocalImageScreen() {
  const tr = useTr();
  const [status, setStatus] = useState<LocalImageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await localImageStatus());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOpen = useCallback(async () => {
    setError(null);
    const path = await pickPath({
      mode: "file",
      title: tr("localimage_pick", undefined, "Choose a game image"),
      filters: [
        {
          name: tr("localimage_filter", undefined, "Disk images"),
          extensions: ["exfat", "img", "image", "raw"],
        },
      ],
    });
    if (!path) return;
    setBusy(true);
    try {
      const info = await localImageAttach(path);
      await refresh();
      // Open the mounted volume straight away — the whole point is to
      // get the user to the files, not to a device name.
      if (info.mount_point) {
        void openExternalUrl(`file://${info.mount_point}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh, tr]);

  const handleDetach = useCallback(
    async (a: AttachedImage) => {
      setError(null);
      setBusy(true);
      try {
        await localImageDetach(a.device);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const unsupported = status && !status.supported;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader
        icon={HardDrive}
        title={tr("localimage_title", undefined, "Edit Game Image")}
        description={tr(
          "localimage_subtitle",
          undefined,
          "Open a game image on this computer to change the files inside it",
        )}
        right={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<FolderOpen size={14} />}
            onClick={() => void handleOpen()}
            disabled={busy || !!unsupported}
          >
            {busy ? (
              <Spinner size={14} tone="inherit" />
            ) : (
              tr("localimage_open", undefined, "Open an image")
            )}
          </Button>
        }
      />

      {error && <ErrorCard title={error} />}

      {unsupported && (
        <Callout
          tone="warn"
          title={tr(
            "localimage_unsupported",
            undefined,
            "Not available on this system",
          )}
          className="mb-4"
        >
          {status?.unsupported_reason}
        </Callout>
      )}

      {/* What this does, and — just as importantly — what it does not.
          People arrive here expecting an editor. */}
      <Callout
        tone="info"
        title={tr("localimage_how", undefined, "How this works")}
        className="mb-5"
      >
        <span className="flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            {tr(
              "localimage_explain",
              undefined,
              "This opens the image as a drive on this computer, so you can replace patch files or edit details inside it with your normal tools. ps5upload does not change the image itself — your operating system does all the writing. Eject it here when you are finished.",
            )}
          </span>
        </span>
      </Callout>

      {status && status.attached.length === 0 && !unsupported && (
        <EmptyState
          icon={HardDrive}
          title={tr("localimage_none", undefined, "No image open")}
          message={tr(
            "localimage_none_hint",
            undefined,
            "Choose a .exfat or .img file to open it as a drive.",
          )}
        />
      )}

      {status?.attached.map((a) => (
        <Card key={a.device} className="mb-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {basename(a.image)}
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]">
                {a.mount_point ||
                  tr(
                    "localimage_not_mounted",
                    undefined,
                    "attached, but nothing could be mounted from it",
                  )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {a.mount_point && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<FolderOpen size={13} />}
                  onClick={() =>
                    void openExternalUrl(`file://${a.mount_point}`)
                  }
                >
                  {tr("localimage_reveal", undefined, "Show files")}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Eject size={13} />}
                disabled={busy}
                onClick={() => void handleDetach(a)}
              >
                {tr("localimage_eject", undefined, "Eject")}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
