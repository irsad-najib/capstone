"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import { Card, Footer, OfflineBanner, StatusDot } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, backendUrl, type DevicesResponse, type RawResult } from "@/lib/api";
import { formatAgo, formatDuration } from "@/lib/abr";
import { useSettings } from "@/lib/settings";
import { MdArrowForward, MdMemory, MdRefresh, MdRouter, MdSensors, MdStorage } from "react-icons/md";

// ADS1299: Vref 4.5 V, gain 24 → skala penuh ±187 500 µV (lihat processor.RawADCToUV)
const ADS_FULL_SCALE_UV = (4.5 / 24) * 1e6;
const FRAME_FRESH_MS = 3000;

type DevicesWithRate = DevicesResponse & { fps: Record<string, number>; at: number };

/** Ambil sinyal mentah terakhir sekali tiap paket untuk cek saturasi. */
function useRawPeak(): { peak: number | null; at: number | null } {
  const [state, setState] = useState<{ peak: number | null; at: number | null }>({ peak: null, at: null });
  const { backendUrl: urlSetting } = useSettings();
  useEffect(() => {
    const es = new EventSource(`${backendUrl()}/api/v1/raw/stream`);
    let last = 0;
    es.onmessage = e => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      try {
        const p = JSON.parse(e.data) as RawResult;
        let peak = 0;
        for (const ch of p.samples ?? []) for (const v of ch) peak = Math.max(peak, Math.abs(v));
        setState({ peak: (p.samples?.[0]?.length ?? 0) ? peak : null, at: now });
      } catch {}
    };
    return () => es.close();
  }, [urlSetting]);
  return state;
}

export default function DevicePage() {
  // frames/s dihitung dari selisih counter antar polling
  const prevRef = useRef<DevicesWithRate | null>(null);
  const devicesFetcher = useCallback(async (): Promise<DevicesWithRate> => {
    const d = await api.devices();
    const at = Date.now();
    const prev = prevRef.current;
    const fps: Record<string, number> = {};
    for (const dev of d.detail ?? []) {
      const p = prev?.detail?.find(x => x.id === dev.id);
      if (p && prev && at > prev.at && (dev.frames ?? 0) >= (p.frames ?? 0)) {
        fps[dev.id] = (((dev.frames ?? 0) - (p.frames ?? 0)) * 1000) / (at - prev.at);
      }
    }
    const out = { ...d, fps, at };
    prevRef.current = out;
    return out;
  }, []);

  const health  = useBackend(api.health, 5_000);
  const devices = useBackend(devicesFetcher, 2_000);
  const abr     = useBackend(api.abrResult, 3_000);
  const stim    = useBackend(api.stim, 5_000);
  const raw     = useRawPeak();

  const online = health.data?.status === "ok" && !health.error;
  const detail = devices.data?.detail ?? [];
  const connected = detail.filter(d => d.connected);
  const now = devices.data?.at ?? 0;
  const fresh = connected.some(d => d.last_frame_at && now - new Date(d.last_frame_at).getTime() < FRAME_FRESH_MS);
  const totalFps = connected.reduce((n, d) => n + (devices.data?.fps[d.id] ?? 0), 0);
  const saturated = raw.peak != null && raw.peak >= 0.95 * ADS_FULL_SCALE_UV;

  const checks: { label: string; state: boolean | null; detail: string }[] = [
    { label: "Backend health", state: health.loading ? null : online, detail: online ? "GET /api/v1/health ok" : health.error ?? "checking" },
    { label: "Device connected", state: devices.loading ? null : connected.length > 0, detail: connected.length ? connected.map(d => d.id).join(", ") : "no WebSocket client on /ws" },
    { label: "Frames arriving", state: connected.length ? fresh : null, detail: fresh ? `${Math.round(totalFps).toLocaleString()} frames/s` : "no frame in the last 3 s" },
    { label: "Stimulus markers present", state: abr.data ? (abr.data.stim_count ?? 0) > 0 : null, detail: `${(abr.data?.stim_count ?? 0).toLocaleString()} markers since reset` },
    { label: "Signal not saturated", state: raw.peak == null ? null : !saturated, detail: raw.peak == null ? "no raw samples" : `peak ${Math.round(raw.peak).toLocaleString()} µV of ±${ADS_FULL_SCALE_UV.toLocaleString()} µV` },
  ];

  const hops = [
    { label: "Headset", ok: raw.peak == null ? null : !saturated },
    { label: "ESP32", ok: connected.length ? true : devices.loading ? null : false },
    { label: "Wi-Fi / WS", ok: connected.length ? fresh : null },
    { label: "Backend", ok: health.loading ? null : online },
    { label: "Dashboard", ok: true },
  ];

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div>
              <h1 className="text-lg font-bold text-primary">Device Status</h1>
              <p className="text-[11px] text-on-surface-variant">Acquisition hardware and backend link</p>
            </div>
          </>
        }
        right={
          <button
            onClick={() => { health.refetch(); devices.refetch(); abr.refetch(); stim.refetch(); }}
            className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low rounded-full"
            title="Refresh" aria-label="Refresh"
          >
            <MdRefresh className="text-xl" />
          </button>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-6">
        {health.error && <OfflineBanner message={`Backend ${backendUrl()} is unreachable — ${health.error}`} onRetry={health.refetch} />}

        {/* ── Signal path ─────────────────────────────────────── */}
        <Card title="Signal path">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {hops.map((h, i) => (
              <li key={h.label} className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-semibold">
                  <StatusDot ok={h.ok} pulse />{h.label}
                </span>
                {i < hops.length - 1 && <MdArrowForward className="text-outline" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Devices ───────────────────────────────────────── */}
          <Card title="Network link" icon={<MdRouter className="text-secondary" />} className="lg:col-span-2">
            {detail.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                {devices.loading ? "Loading…" : <>No device has connected yet. ESP32 connects to <span className="font-mono">{backendUrl().replace(/^http/, "ws")}/ws?id=&lt;device-id&gt;</span>.</>}
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/60 -my-2">
                {detail.map(d => {
                  const fps = devices.data?.fps[d.id];
                  const audio = d.audio_test;
                  return (
                    <li key={d.id} className="py-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 font-mono text-sm font-bold"><StatusDot ok={d.connected} pulse />{d.id}</p>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${d.connected ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"}`}>
                          {d.connected ? `Connected${d.connections > 1 ? ` ×${d.connections}` : ""}` : "Disconnected"}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <Stat label="WebSocket" value={d.connected ? "open" : "closed"} />
                        <Stat label="Last message" value={formatAgo(d.last_seen, now)} />
                        <Stat label="Last EEG frame" value={formatAgo(d.last_frame_at, now)} />
                        <Stat label="Frames/s" value={d.connected && fps != null ? Math.round(fps).toLocaleString() : "—"} />
                        <Stat label="Total frames" value={(d.frames ?? 0).toLocaleString()} />
                        {audio && (
                          <>
                            <Stat label="Tone" value={audio.on ? `on · ${audio.freq ?? "?"} Hz` : "off"} />
                            <Stat label="Level" value={audio.level_dbfs != null ? `${audio.level_dbfs} dBFS · ${audio.ch ?? ""}` : "—"} />
                            <Stat label="ESP uptime" value={audio.uptime_ms != null ? formatDuration(audio.uptime_ms / 1000) : "—"} />
                          </>
                        )}
                      </dl>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* ── Acquisition summary ──────────────────────────── */}
          <Card title="Acquisition summary" icon={<MdStorage className="text-secondary" />}>
            <dl className="space-y-2 text-sm">
              <Row label="Backend uptime" value={health.data?.uptime_s != null ? formatDuration(health.data.uptime_s) : "—"} />
              <Row label="Frames since reset" value={(abr.data?.frame_count ?? 0).toLocaleString()} />
              <Row label="Stimuli since reset" value={(abr.data?.stim_count ?? 0).toLocaleString()} />
              <Row label="Trials averaged" value={(abr.data?.trial_count ?? 0).toLocaleString()} />
              <Row label="Stimulus" value={stim.data ? (stim.data.running ? `running @ ${stim.data.db} dB` : `idle (${stim.data.db} dB)`) : "—"} />
              <Row label="MongoDB" value={health.data ? (health.data.mongo ? "on" : "off (files only)") : "—"} />
            </dl>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card title="Hardware interfaces" icon={<MdMemory className="text-secondary" />}>
            <dl className="space-y-2 text-sm">
              <Row label="ADC" value="ADS1299 · 24-bit" />
              <Row label="Gain / Vref" value="×24 / 4.5 V" />
              <Row label="Resolution" value="0.0224 µV / LSB" />
              <Row label="Sampling rate" value={abr.data ? `${abr.data.sampling_rate.toLocaleString()} Hz` : "—"} />
              <Row label="Channels" value={abr.data ? `${abr.data.abr_average.length}` : "—"} />
              <Row label="Epoch" value={abr.data ? `${abr.data.epoch_ms} ms (${abr.data.pre_stim_ms ?? 10} ms pre)` : "—"} />
              <Row label="DAC" value="PCM5102A (I2S)" />
            </dl>
          </Card>

          <Card title="Runtime checks" icon={<MdSensors className="text-secondary" />} className="lg:col-span-2">
            <ul className="space-y-2">
              {checks.map(c => (
                <li key={c.label} className="flex items-start gap-3 rounded-lg border border-outline-variant/60 px-3 py-2.5">
                  <span aria-hidden="true" className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                    c.state == null ? "bg-surface-container-high text-on-surface-variant" : c.state ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"}`}>
                    {c.state == null ? "?" : c.state ? "✓" : "✕"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{c.label} <span className="sr-only">{c.state == null ? "unknown" : c.state ? "ok" : "failed"}</span></p>
                    <p className="text-xs text-on-surface-variant font-mono truncate">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Footer />
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-low px-3 py-2">
      <dt className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">{label}</dt>
      <dd className="font-mono tabular-nums font-semibold text-on-surface mt-0.5">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="font-mono tabular-nums text-right">{value}</dd>
    </div>
  );
}
