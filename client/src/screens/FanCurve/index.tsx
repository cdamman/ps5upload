import { useCallback, useEffect, useState } from "react";
import { Fan, Plus, Trash2, Check, Activity, Info } from "lucide-react";
import {
  PageHeader,
  Button,
  ErrorCard,
  ConnectionGate,
  Spinner,
} from "../../components";
import { useConfirm } from "../../components/ConfirmDialog";
import { useTr } from "../../state/lang";
import { useConnectionStore } from "../../state/connection";
import { useStaleHostGuard } from "../../lib/staleHostGuard";
import { transferAddr } from "../../lib/addr";
import { fanCurveSet, fanCurveGet, type FanCurvePoint } from "../../api/ps5";
import { humanizePs5Error } from "../../lib/humanizeError";

const DEFAULT_POINTS: FanCurvePoint[] = [
  { temp_c: 50, duty_pct: 30 },
  { temp_c: 65, duty_pct: 55 },
  { temp_c: 75, duty_pct: 80 },
  { temp_c: 85, duty_pct: 100 },
];

export default function FanCurveScreen() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const addr = host ? transferAddr(host) : "";
  const { confirm, dialog: confirmDialog } = useConfirm();
  const guard = useStaleHostGuard();

  const [points, setPoints] = useState<FanCurvePoint[]>(DEFAULT_POINTS);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [hasSavedCurve, setHasSavedCurve] = useState(false);

  // Load persisted curve on mount / addr change
  useEffect(() => {
    if (!addr || payloadStatus !== "up") {
      setLoading(false);
      return;
    }
    const probe = guard.capture();
    setLoading(true);
    setError(null);
    fanCurveGet(addr)
      .then((res) => {
        if (probe.isStale()) return;
        const pts = res.points;
        if (pts && pts.length > 0) {
          setPoints(pts);
          setHasSavedCurve(true);
        }
      })
      .catch(() => {
        // Non-fatal — the curve just isn't persisted yet
      })
      .finally(() => {
        if (!probe.isStale()) setLoading(false);
      });
  }, [addr, payloadStatus, guard]);

  const sorted = [...points].sort((a, b) => a.temp_c - b.temp_c);

  const updatePoint = useCallback((idx: number, patch: Partial<FanCurvePoint>) => {
    setPoints((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
    setApplied(false);
  }, []);

  const removePoint = useCallback((idx: number) => {
    setPoints((prev) => prev.filter((_, i) => i !== idx));
    setApplied(false);
  }, []);

  const addPoint = useCallback(() => {
    setPoints((prev) => [...prev, { temp_c: 70, duty_pct: 60 }]);
    setApplied(false);
  }, []);

  const handleApply = useCallback(async () => {
    if (!addr) return;
    const ok = await confirm({
      title: tr("fanCurve_confirm_title", undefined, "Apply fan curve?"),
      message: tr(
        "fanCurve_confirm_msg",
        undefined,
        "This overrides the PS5's built-in fan control. Incorrect settings may cause overheating. The first point's temperature becomes the persistent fan threshold — it survives payload redeploy and console reboot.",
      ),
      confirmLabel: tr("fanCurve_apply", undefined, "Apply"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const probe = guard.capture();
    try {
      await fanCurveSet(sorted, addr);
      if (probe.isStale()) return;
      setApplied(true);
      setHasSavedCurve(true);
    } catch (e) {
      if (probe.isStale()) return;
      setError(humanizePs5Error(String(e)));
    } finally {
      setBusy(false);
    }
  }, [addr, confirm, tr, sorted, guard]);

  // SVG preview
  const W = 320;
  const H = 120;
  const PAD = 24;
  const tempMin = 30;
  const tempMax = 95;
  const xFor = (t: number) =>
    PAD + ((t - tempMin) / (tempMax - tempMin)) * (W - PAD * 2);
  const yFor = (p: number) => PAD + (1 - p / 100) * (H - PAD * 2);
  const polyPath = sorted
    .map((p) => `${xFor(p.temp_c).toFixed(1)},${yFor(p.duty_pct).toFixed(1)}`)
    .join(" ");

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader
        icon={Fan}
        title={tr("fanCurve_title", undefined, "Fan Curve")}
        description={tr(
          "fanCurve_subtitle",
          undefined,
          "Define a custom fan duty curve by temperature. Persists across reboots.",
        )}
      />

      <ConnectionGate>
        {error && <ErrorCard title={error} />}

        {applied && (
          <div className="rounded-lg border border-[var(--color-good)] bg-[var(--color-good-soft)] px-4 py-3 text-sm text-[var(--color-good)]">
            <div className="flex items-center gap-2 font-medium">
              <Check size={14} />
              {tr("fanCurve_applied", undefined, "Fan curve applied and saved")}
            </div>
          </div>
        )}

        {/* Persistence info banner */}
        {hasSavedCurve && !applied && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-text)]">
            <Info size={14} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
            <span>
              {tr(
                "fanCurve_persisted",
                undefined,
                "A fan curve is saved on this PS5. The first point's temperature is the active fan threshold and auto-restores on every payload load — no desktop app needed.",
              )}
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : (
          <>
            {/* Visual preview */}
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <Activity size={16} />
                {tr("fanCurve_preview", undefined, "Curve preview")}
              </h3>
              <svg width={W} height={H} className="block max-w-full">
                {[0, 50, 100].map((p) => (
                  <line
                    key={p}
                    x1={PAD}
                    y1={yFor(p)}
                    x2={W - PAD}
                    y2={yFor(p)}
                    stroke="var(--color-border)"
                    strokeDasharray="2 3"
                  />
                ))}
                {sorted.length > 1 && (
                  <polyline
                    points={polyPath}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                )}
                {sorted.map((p, i) => (
                  <circle
                    key={i}
                    cx={xFor(p.temp_c)}
                    cy={yFor(p.duty_pct)}
                    r={3}
                    fill="var(--color-accent)"
                  />
                ))}
                <text x={PAD} y={H - 4} fontSize="9" fill="var(--color-muted)">
                  {tempMin}°C
                </text>
                <text
                  x={W - PAD}
                  y={H - 4}
                  fontSize="9"
                  fill="var(--color-muted)"
                  textAnchor="end"
                >
                  {tempMax}°C
                </text>
              </svg>
            </div>

            {/* Point editor */}
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                  <Fan size={16} />
                  {tr("fanCurve_points", undefined, "Curve points")}
                </h3>
                <Button variant="ghost" size="sm" onClick={addPoint} disabled={busy}>
                  <Plus size={14} />
                  {tr("fanCurve_add", undefined, "Add")}
                </Button>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-xs text-[var(--color-muted)]">
                  <span>{tr("fanCurve_temp", undefined, "Temp (°C)")}</span>
                  <span>{tr("fanCurve_duty", undefined, "Duty (%)")}</span>
                  <span />
                </div>
                {points.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                  >
                    <input
                      type="number"
                      value={p.temp_c}
                      min={0}
                      max={100}
                      inputMode="numeric"
                      onChange={(e) =>
                        updatePoint(i, { temp_c: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                    />
                    <input
                      type="number"
                      value={p.duty_pct}
                      min={0}
                      max={100}
                      inputMode="numeric"
                      onChange={(e) =>
                        updatePoint(i, { duty_pct: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removePoint(i)}
                      disabled={busy || points.length <= 1}
                      className="text-[var(--color-bad)]"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleApply}
                  disabled={
                    busy || points.length === 0 || payloadStatus !== "up" || !addr
                  }
                >
                  {busy ? (
                    <Spinner size={14} tone="inherit" />
                  ) : (
                    <Fan size={14} />
                  )}
                  {tr("fanCurve_apply", undefined, "Apply")}
                </Button>
              </div>
            </div>
          </>
        )}
      </ConnectionGate>
      {confirmDialog}
    </div>
  );
}
