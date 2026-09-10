"use client";

import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { MdCloud, MdPsychology, MdSensors, MdSignalCellularAlt } from "react-icons/md";

export default function DashboardMetrics() {
  const health  = useBackend(api.health,   5_000);
  const devices = useBackend(api.devices,  5_000);
  const abr     = useBackend(api.abrResult, 3_000);

  const isOnline       = health.data?.status === "ok";
  const connectedCount = devices.data?.devices.length ?? 0;
  const deviceName     = devices.data?.devices[0] ?? "—";
  const trialCount     = abr.data?.trial_count ?? 0;
  const quality        = abr.data?.quality ?? "—";

  const metrics = [
    {
      label: "Backend Status",
      value: health.loading ? "…" : isOnline ? "Online" : "Offline",
      valueClass: isOnline ? "text-secondary" : "text-error",
      sub: health.data?.time ? new Date(health.data.time).toLocaleTimeString() : undefined,
      dot: isOnline,
      icon: MdCloud,
    },
    {
      label: "Connected Devices",
      value: connectedCount.toString(),
      sub: connectedCount > 0 ? deviceName : "No device",
      icon: MdSensors,
      valueClass: connectedCount > 0 ? "text-primary" : "text-on-surface-variant",
    },
    {
      label: "ABR Trials",
      value: trialCount > 0 ? trialCount.toLocaleString() : "—",
      sub: quality,
      icon: MdPsychology,
      valueClass: "text-primary",
    },
    {
      label: "SNR (Ch 0)",
      value: abr.data?.snr?.[0] != null ? `${abr.data.snr[0].toFixed(1)} dB` : "—",
      sub: "ADS1115 / ADS1299",
      icon: MdSignalCellularAlt,
      valueClass: (abr.data?.snr?.[0] ?? 0) > 3 ? "text-secondary" : "text-on-surface-variant",
    },
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map(({ label, value, sub, dot, icon: Icon, valueClass }) => (
        <div key={label} className="bg-white border border-outline-variant/60 p-6 rounded-2xl flex flex-col justify-between h-36 hover:border-secondary transition-all">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
            <Icon className="text-outline text-[22px]" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${valueClass ?? "text-primary"}`}>{value}</span>
              {dot && <span className="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse" />}
            </div>
            {sub && <span className="text-xs text-on-surface-variant mt-0.5">{sub}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}
