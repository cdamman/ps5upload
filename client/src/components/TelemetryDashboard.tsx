/**
 * Telemetry dashboard (v5 §11.4).
 *
 * Charts (sparklines + numeric) for the canonical sensor paths:
 * CPU temp, SoC temp, fan duty, power consumption, lifetime hours.
 *
 * Pulls from the shared `useSensors` store — no independent polling.
 * The dashboard is "live" as long as the host is connected; when
 * disconnected, shows an empty state.
 *
 * Future: CSV export, threshold overlays, time-range picker.
 */
import { useMemo } from "react";
import { Activity, Thermometer, Fan, Zap, Clock } from "lucide-react";

import { Card, EmptyState, Sparkline, Badge } from "./index";
import { useTr } from "../state/lang";
import { useConnectionStore } from "../state/connection";
import { useSensors } from "../state/sensors";
import { formatDuration } from "../lib/format";

export function TelemetryDashboard() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const { sample, history } = useSensors(host);

  const connected = payloadStatus === "up";

  // Extract per-metric time series from the sample history.
  const series = useMemo(() => {
    if (history.length < 2) return null;
    return {
      cpuTemp: history.map((s) => s.temps.cpu_temp),
      socTemp: history.map((s) => s.temps.soc_temp),
      fanDuty: history.map((s) => s.temps.fan_duty_pct),
      power: history.map((s) => s.power.power_consumption_mw / 1000),
    };
  }, [history]);

  if (!connected) {
    return (
      <EmptyState
        icon={Activity}
        title={tr("telemetry_not_connected", undefined, "Not connected")}
        message={tr(
          "telemetry_not_connected_desc",
          undefined,
          "Connect to your PS5 to see live telemetry.",
        )}
      />
    );
  }

  if (!sample || !series) {
    return (
      <EmptyState
        icon={Activity}
        title={tr("telemetry_waiting", undefined, "Waiting for data")}
        message={tr(
          "telemetry_waiting_desc",
          undefined,
          "Sensor readings will appear here within a few seconds.",
        )}
      />
    );
  }

  const cpuTemp = sample.temps.cpu_temp;
  const socTemp = sample.temps.soc_temp;
  const fanDuty = sample.temps.fan_duty_pct;
  const powerW = sample.power.power_consumption_mw / 1000;

  // Threshold-based coloring
  const tempColor = (t: number) =>
    t >= 85 ? "var(--color-warn)" : t >= 95 ? "var(--color-bad)" : "var(--color-text)";
  const fanColor = (d: number) =>
    d >= 80 ? "var(--color-warn)" : "var(--color-text)";

  return (
    <div className="space-y-4">
      {/* Summary cards row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* CPU temp */}
        <MetricCard
          icon={Thermometer}
          label={tr("telemetry_cpu_temp", undefined, "CPU Temp")}
          value={`${cpuTemp.toFixed(0)}°C`}
          tone={cpuTemp >= 85 ? "warn" : undefined}
          sparkData={series.cpuTemp}
          sparkColor={tempColor(cpuTemp)}
        />
        {/* SoC temp */}
        <MetricCard
          icon={Thermometer}
          label={tr("telemetry_soc_temp", undefined, "SoC Temp")}
          value={`${socTemp.toFixed(0)}°C`}
          tone={socTemp >= 85 ? "warn" : undefined}
          sparkData={series.socTemp}
          sparkColor={tempColor(socTemp)}
        />
        {/* Fan duty */}
        <MetricCard
          icon={Fan}
          label={tr("telemetry_fan_duty", undefined, "Fan Duty")}
          value={fanDuty >= 0 ? `${fanDuty.toFixed(0)}%` : "—"}
          tone={fanDuty >= 80 ? "warn" : undefined}
          sparkData={fanDuty >= 0 ? series.fanDuty : undefined}
          sparkColor={fanColor(fanDuty)}
          minY={0}
          maxY={100}
        />
        {/* Power */}
        <MetricCard
          icon={Zap}
          label={tr("telemetry_power", undefined, "Power")}
          value={`${powerW.toFixed(1)} ${tr("telemetry_watts", undefined, "W")}`}
          sparkData={series.power}
        />
      </div>

      {/* Detail section */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock size={16} className="text-[var(--color-muted)]" />
            {tr("telemetry_lifetime", undefined, "Lifetime")}
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">
                {tr("telemetry_operating_hours", undefined, "Operating time")}
              </dt>
              <dd>{formatDuration(sample.power.operating_time_sec)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">
                {tr("telemetry_boot_count", undefined, "Boot count")}
              </dt>
              <dd>{sample.power.boot_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">
                {tr("telemetry_load_avg", undefined, "Load avg (1m)")}
              </dt>
              <dd>{sample.power.load_avg_1m.toFixed(2)}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Activity size={16} className="text-[var(--color-muted)]" />
            {tr("telemetry_overview", undefined, "Overview")}
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">
                {tr("telemetry_cpu_usage", undefined, "CPU usage")}
              </dt>
              <dd>
                {sample.temps.cpu_usage_pct >= 0
                  ? `${sample.temps.cpu_usage_pct.toFixed(0)}%`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">
                {tr("telemetry_cpu_freq", undefined, "CPU freq")}
              </dt>
              <dd>{(sample.temps.cpu_freq_mhz / 1000).toFixed(2)} {tr("telemetry_ghz", undefined, "GHz")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted)]">
                {tr("telemetry_soc_power", undefined, "SoC power")}
              </dt>
              <dd>{(sample.temps.soc_power_mw / 1000).toFixed(2)} W</dd>
            </div>
            {sample.temps.m2_temp > 0 && (
              <div className="flex justify-between">
                <dt className="text-[var(--color-muted)]">
                  {tr("telemetry_m2_temp", undefined, "M.2 SSD")}
                </dt>
                <dd>{sample.temps.m2_temp.toFixed(0)}°C</dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      {/* Sample count / window indicator */}
      <div className="flex items-center justify-end gap-2 text-xs text-[var(--color-muted)]">
        <Badge tone="neutral" variant="soft">
          {history.length} {tr("telemetry_samples", undefined, "samples")}
        </Badge>
        <span>
          {tr("telemetry_window", undefined, "Last ~")}~
          {Math.round((history.length * 5) / 60)}{" "}
          {tr("telemetry_minutes", undefined, "min")}
        </span>
      </div>
    </div>
  );
}

/** Single metric card with icon, value, and sparkline. */
function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
  sparkData,
  sparkColor,
  minY,
  maxY,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone?: "warn" | "bad";
  sparkData?: number[];
  sparkColor?: string;
  minY?: number;
  maxY?: number;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
            <Icon size={14} />
            {label}
          </div>
          <div
            className={`mt-1 text-2xl font-bold tabular-nums ${
              tone === "warn"
                ? "text-[var(--color-warn)]"
                : tone === "bad"
                  ? "text-[var(--color-bad)]"
                  : ""
            }`}
          >
            {value}
          </div>
        </div>
        {sparkData && sparkData.length >= 2 && (
          <Sparkline
            data={sparkData}
            width={90}
            height={36}
            color={sparkColor ?? "var(--color-text)"}
            fill
            minY={minY}
            maxY={maxY}
          />
        )}
      </div>
    </Card>
  );
}
