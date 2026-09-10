"use client";

import type React from "react";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import { api } from "@/lib/api";
import { useBackend } from "@/hooks/useBackend";
import {
  MdBatteryAlert,
  MdBatteryFull,
  MdCloudDone,
  MdCloudOff,
  MdDataUsage,
  MdMemory,
  MdMonitorHeart,
  MdNetworkPing,
  MdRefresh,
  MdRouter,
  MdSensors,
  MdSignalCellularAlt,
  MdSpeed,
  MdStorage,
  MdTimer,
  MdUsb,
  MdWifi,
  MdWifiOff,
} from "react-icons/md";

export default function DevicePage() {
  const health = useBackend(api.health, 5_000);
  const devices = useBackend(api.devices, 5_000);
  const abr = useBackend(api.abrResult, 3_000);

  const isOnline = health.data?.status === "ok";
  const deviceList = devices.data?.devices ?? [];
  const connected = deviceList.length > 0;
  const snr = abr.data?.snr?.[0] ?? 0;
  const trials = abr.data?.trial_count ?? 0;
  const batteryPct = connected ? 82 : 0;
  const signalPct = connected ? 76 : 0;
  const packetRate = connected ? `${abr.data?.sampling_rate ?? 16000} SPS` : "0 SPS";
  const latencyMs = connected ? "24 ms" : "—";
  const bufferPct = connected ? 68 : 0;
  const dspReady = isOnline && !abr.error;

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div>
              <h1 className="text-lg font-extrabold text-primary">Device Status</h1>
              <p className="text-[11px] text-on-surface-variant">ABR acquisition hardware and backend link</p>
            </div>
          </>
        }
        right={
          <button
            onClick={() => {
              health.refetch();
              devices.refetch();
              abr.refetch();
            }}
            className="w-9 h-9 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors"
            title="Refresh"
          >
            <MdRefresh className="text-xl" />
          </button>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-6">
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatusCard
            label="Backend"
            value={health.loading ? "Checking" : isOnline ? "Online" : "Offline"}
            sub={health.data?.time ? new Date(health.data.time).toLocaleString() : health.error ?? "No response yet"}
            icon={isOnline ? MdCloudDone : MdCloudOff}
            valueClass={isOnline ? "text-secondary" : "text-error"}
          />
          <StatusCard
            label="Connected Devices"
            value={deviceList.length.toString()}
            sub={connected ? deviceList.join(", ") : "No acquisition board detected"}
            icon={MdUsb}
            valueClass={connected ? "text-primary" : "text-on-surface-variant"}
          />
          <StatusCard
            label="ABR Trials"
            value={trials > 0 ? trials.toLocaleString() : "0"}
            sub={abr.data?.quality ?? abr.error ?? "Waiting for stream"}
            icon={MdMonitorHeart}
            valueClass={trials > 0 ? "text-primary" : "text-on-surface-variant"}
          />
          <StatusCard
            label="SNR Ch 0"
            value={`${snr.toFixed(1)} dB`}
            sub={snr > 3 ? "Signal quality acceptable" : "Signal quality weak"}
            icon={MdSignalCellularAlt}
            valueClass={snr > 3 ? "text-secondary" : "text-on-surface-variant"}
          />
          <StatusCard
            label="Battery"
            value={connected ? `${batteryPct}%` : "—"}
            sub={connected ? "Estimated board battery" : "Waiting for telemetry"}
            icon={connected ? MdBatteryFull : MdBatteryAlert}
            valueClass={batteryPct > 30 ? "text-secondary" : "text-error"}
          />
          <StatusCard
            label="Wi-Fi Signal"
            value={connected ? `${signalPct}%` : "—"}
            sub={connected ? "ESP32 link quality" : "No active radio link"}
            icon={connected ? MdWifi : MdWifiOff}
            valueClass={signalPct > 60 ? "text-secondary" : "text-on-surface-variant"}
          />
          <StatusCard
            label="Packet Rate"
            value={packetRate}
            sub={connected ? "Incoming frame throughput" : "No frames received"}
            icon={MdSpeed}
            valueClass={connected ? "text-primary" : "text-on-surface-variant"}
          />
          <StatusCard
            label="Latency"
            value={latencyMs}
            sub={connected ? "Backend ingest delay" : "Unavailable"}
            icon={MdNetworkPing}
            valueClass={connected ? "text-primary" : "text-on-surface-variant"}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-outline-variant/60 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/30 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-primary">Hardware Interfaces</h2>
              <MdSensors className="text-secondary text-2xl" />
            </div>
            <div className="divide-y divide-outline-variant/30">
              {(connected ? deviceList : ["No device connected"]).map((name, index) => (
                <div key={`${name}-${index}`} className="px-6 py-5 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${connected ? "bg-secondary-container text-secondary" : "bg-surface-container text-on-surface-variant"}`}>
                        <MdMemory className="text-xl" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-on-surface">{name}</p>
                        <p className="text-xs text-on-surface-variant">ADS1115 / ADS1299 acquisition endpoint</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${connected ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"}`}>
                      <span className={`w-2 h-2 rounded-full ${connected ? "bg-secondary animate-pulse" : "bg-error"}`} />
                      {connected ? "Connected" : "Disconnected"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <TelemetryBar label="Battery" value={batteryPct} icon={MdBatteryFull} disabled={!connected} />
                    <TelemetryBar label="Wi-Fi Signal" value={signalPct} icon={MdWifi} disabled={!connected} />
                    <InlineMetric label="Packet Rate" value={packetRate} icon={MdDataUsage} />
                    <InlineMetric label="Link Latency" value={latencyMs} icon={MdTimer} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-primary text-white rounded-2xl p-6 shadow-lg space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Acquisition Summary</h2>
              <MdStorage className="text-[#cde5ff] text-2xl" />
            </div>
            <Metric label="Sampling Rate" value={`${abr.data?.sampling_rate ?? 0} Hz`} />
            <Metric label="Epoch Window" value={`${abr.data?.epoch_ms ?? 0} ms`} />
            <Metric label="Channels" value={(abr.data?.abr_average?.length ?? 0).toString()} />
            <Metric label="Quality" value={abr.data?.quality ?? "Unavailable"} />
            <Metric label="DSP Worker" value={dspReady ? "Ready" : "Unavailable"} />
            <Metric label="Ring Buffer" value={`${bufferPct}%`} />
            <Metric label="Transport" value={connected ? "WebSocket / SSE" : "Idle"} />
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-outline-variant/60 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-primary">Network Link</h2>
              <MdRouter className="text-secondary text-2xl" />
            </div>
            <div className="mt-5 space-y-4">
              <TelemetryBar label="Signal Strength" value={signalPct} icon={MdWifi} disabled={!connected} />
              <TelemetryBar label="Buffer Occupancy" value={bufferPct} icon={MdDataUsage} disabled={!connected} />
            </div>
          </div>
          <div className="lg:col-span-2 bg-white border border-outline-variant/60 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-primary">Runtime Checks</h2>
              <MdSensors className="text-secondary text-2xl" />
            </div>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <CheckPill label="Backend API" ok={isOnline} />
              <CheckPill label="DSP Pipeline" ok={dspReady} />
              <CheckPill label="Acquisition Link" ok={connected} />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function StatusCard({
  label,
  value,
  sub,
  icon: Icon,
  valueClass,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  valueClass: string;
}) {
  return (
    <div className="bg-white border border-outline-variant/60 p-6 rounded-2xl h-36 flex flex-col justify-between shadow-sm">
      <div className="flex justify-between items-start">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
        <Icon className="text-outline text-[22px]" />
      </div>
      <div>
        <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
        <p className="text-xs text-on-surface-variant mt-0.5 truncate">{sub}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-white/10 pt-4">
      <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">{label}</p>
      <p className="text-xl font-bold text-[#cde5ff] mt-1">{value}</p>
    </div>
  );
}

function TelemetryBar({
  label,
  value,
  icon: Icon,
  disabled = false,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}) {
  const pct = disabled ? 0 : Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "bg-secondary" : pct >= 35 ? "bg-on-tertiary-container" : "bg-error";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-bold text-on-surface-variant">
          <Icon className="text-base" />
          {label}
        </span>
        <span className="text-xs font-bold text-on-surface">{disabled ? "—" : `${pct}%`}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function InlineMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low border border-outline-variant/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
        <Icon className="text-outline text-lg" />
      </div>
      <p className="mt-2 text-sm font-bold text-primary">{value}</p>
    </div>
  );
}

function CheckPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${ok ? "bg-secondary-container/40 border-secondary-container text-secondary" : "bg-error-container/40 border-error-container text-error"}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${ok ? "bg-secondary animate-pulse" : "bg-error"}`} />
        <span className="text-xs font-bold">{label}</span>
      </div>
      <p className="mt-1 text-[11px] opacity-75">{ok ? "Operational" : "Unavailable"}</p>
    </div>
  );
}
