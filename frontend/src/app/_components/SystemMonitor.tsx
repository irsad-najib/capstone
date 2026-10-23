"use client";

import { Card, StatusDot } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";

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
      sub: online ? "" : "Sessions and live scans are unavailable",
    },
    {
      label: "Device",
      ok: devices.loading ? null : ids.length > 0,
      value: ids.length ? `${ids.length} connected` : "None",
      sub: ids.length ? ids.join(", ") : "Turn on the headset and wait for it to connect",
    },
    {
      label: "Stimulus",
      ok: stim.data ? (stim.data.running ? true : null) : null,
      value: stim.data ? (stim.data.running ? `Running at ${stim.data.db} dB` : "Idle") : "—",
      sub: stim.data?.running && stim.data.started_at ? `since ${new Date(stim.data.started_at).toLocaleTimeString()}` : "",
    },
  ];

  return (
    <Card title="System">
      <ul className="divide-y divide-outline-variant/50 -my-2.5">
        {rows.map(r => (
          <li key={r.label} className="py-2.5 flex items-start gap-3">
            <span className="mt-1.5"><StatusDot ok={r.ok} pulse /></span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2 text-sm">
                <span className="text-on-surface-variant">{r.label}</span>
                <span className="font-medium text-on-surface text-right">{r.value}</span>
              </div>
              {r.sub && <p className="text-xs text-on-surface-variant truncate mt-0.5">{r.sub}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
