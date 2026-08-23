import { beforeEach, describe, expect, it } from "vitest";
import { transferScreenBusy } from "../lib/ps5Transfers";
import { useTransferStore } from "../state/transfer";
import { useUploadQueueStore } from "../state/uploadQueue";

/**
 * Regression guard for the auto-redeploy loop.
 *
 * A user's bug bundle showed a 20 GB upload that could never finish: the
 * transfer saturated the console at ~150 MB/s, the mgmt-port health poll
 * started timing out, the helper was declared "down", auto-redeploy pushed a
 * fresh payload, the new instance took over and the old one shut down — which
 * killed the upload mid-flight. It then restarted and did it again. 33
 * redeploys, 23 helper shutdowns, 132 GB re-sent for a 20 GB archive.
 *
 * `AppShell`'s redeploy tick fires when `payloadStatus === "down" &&
 * !transferScreenBusy(host)`. These tests pin the predicate that gates it,
 * per-console, so a live upload can never be redeployed over again.
 */
describe("auto-redeploy must not fire over a live transfer", () => {
  const HOST = "192.168.88.2";
  const OTHER = "192.168.88.9";

  beforeEach(() => {
    useTransferStore.setState({ phasesByHost: {} });
    useUploadQueueStore.setState({ items: [], running: false });
  });

  it("reports busy while a one-shot upload to that console is running", () => {
    expect(transferScreenBusy(HOST)).toBe(false);
    useTransferStore.setState({
      phasesByHost: {
        [HOST]: {
          kind: "running",
          jobId: "j1",
          startedAtMs: 1,
          bytesSent: 1,
          totalBytes: 2,
          bytesPerSec: 1,
          files: [],
          filesCompleted: 0,
          skippedFiles: 0,
          skippedBytes: 0,
          filesFinalized: 0,
          filesFinalizingTotal: 0,
          bytesFinalized: 0,
        },
      },
    });
    expect(transferScreenBusy(HOST)).toBe(true);
  });

  it("counts the 'starting' phase too — the window before the job id lands", () => {
    // The upload is already committed at this point; a redeploy here is just
    // as destructive as one mid-stream.
    useTransferStore.setState({ phasesByHost: { [HOST]: { kind: "starting" } } });
    expect(transferScreenBusy(HOST)).toBe(true);
  });

  it("is scoped per console — a busy console A must not block console B", () => {
    useTransferStore.setState({ phasesByHost: { [HOST]: { kind: "starting" } } });
    expect(transferScreenBusy(HOST)).toBe(true);
    // B is idle: a genuinely dead helper on B must still be redeployable.
    expect(transferScreenBusy(OTHER)).toBe(false);
  });

  it("is not busy once the transfer reaches a terminal phase", () => {
    useTransferStore.setState({
      phasesByHost: { [HOST]: { kind: "failed", error: "boom" } },
    });
    expect(transferScreenBusy(HOST)).toBe(false);
  });
});
