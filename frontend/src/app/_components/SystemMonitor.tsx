"use client";

import { StatusDot } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, backendUrl } from "@/lib/api";
import { formatDuration } from "@/lib/abr";
import { MdMonitorHeart } from "react-icons/md";

export default function SystemMonitor() {
  const health  = useBackend(api.health, 5_000);
  const devices = useBackend(api.devices, 5_000);
  const stim    = useBackend(api.stim, 5_000);

  const online = health.data?.status === "ok" && !health.error;
  const ids = devices.data?.devices ?? [];

  const rows = [
    {
      label: "Backend",
      ok: health.loading ? null : online,
      value: health.loading ? "Checking…" : online ? "Online" : "Offline",
      sub: online && health.data
        ? `checked ${new Date(health.data.time).toLocaleTimeString()} · up ${formatDuration(health.data.uptime_s ?? 0)}`
        : backendUrl(),
    },
    {
      label: "Device",
      ok: devices.loading ? null : ids.length > 0,
      value: ids.length ? `${ids.length} connected` : "None",
      sub: ids.length ? ids.join(", ") : "Waiting for ESP32 on /ws",
    },
    {
      label: "Stimulus",
      ok: stim.data ? (stim.data.running ? true : null) : null,
      value: stim.data ? (stim.data.running ? `Running @ ${stim.data.db} dB` : "Idle") : "—",
      sub: stim.data?.running && stim.data.started_at ? `since ${new Date(stim.data.started_at).toLocaleTimeString()}` : `level ${stim.data?.db ?? "—"} dB`,
    },
    {
      label: "MongoDB",
      ok: health.data ? !!health.data.mongo : null,
      value: health.data ? (health.data.mongo ? "On" : "Off") : "—",
      sub: health.data ? (health.data.mongo ? "sessions stored in Mongo + files" : "sessions stored as JSON files only") : "",
    },
  ];

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-primary">System monitoring</h2>
        <MdMonitorHeart className="text-secondary text-xl" />
      </div>
      <ul className="divide-y divide-outline-variant/60">
        {rows.map(r => (
          <li key={r.label} className="py-3 flex items-start gap-3">
            <span className="mt-1.5"><StatusDot ok={r.ok} pulse /></span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2 text-sm">
                <span className="text-on-surface-variant">{r.label}</span>
                <span className="font-semibold text-on-surface text-right">{r.value}</span>
              </div>
              {r.sub && <p className="text-[11px] text-on-surface-variant font-mono truncate">{r.sub}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
