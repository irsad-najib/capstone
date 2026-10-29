"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import { Badge, Button, Card, Footer, OfflineBanner, Page, Row, Stat, StatusDot } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, backendUrl, type DevicesResponse, type RawResult } from "@/lib/api";
import { formatAgo, formatDuration } from "@/lib/abr";
import { useSettings } from "@/lib/settings";
import { MdCheck, MdClose, MdRefresh } from "react-icons/md";

// ADS1256: ±2·2.5 V (PGA 1), AD620 ×20 → skala penuh ±250 000 µV di elektroda (lihat processor.RawADCToUV)
const ADS_FULL_SCALE_UV = (5 / 20) * 1e6;
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
  const saturated = raw.peak != null && raw.peak >= 0.95 * ADS_FULL_SCALE_UV;

  // Bahasa biasa: kalau aman cukup centang, kalau tidak beri tahu apa yang perlu dilakukan.
  const checks: { label: string; state: boolean | null; warning: string }[] = [
    { label: "Server reachable", state: health.loading ? null : online, warning: "The server cannot be reached. Check the internet connection." },
    { label: "Headset connected", state: devices.loading ? null : connected.length > 0, warning: "Turn on the headset and wait until it connects." },
    { label: "Signal arriving", state: connected.length ? fresh : null, warning: "The headset is connected but no signal is coming in." },
    { label: "Sound playing", state: abr.data ? (abr.data.stim_count ?? 0) > 0 : null, warning: "No test sound has played yet. Start a test to check." },
    { label: "Signal level OK", state: raw.peak == null ? null : !saturated, warning: "The signal is too strong. Check that the electrodes sit firmly." },
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
        title="Device status"
        actions={
          <Button
            variant="ghost" size="icon"
            onClick={() => { health.refetch(); devices.refetch(); abr.refetch(); stim.refetch(); }}
            title="Refresh" aria-label="Refresh"
          >
            <MdRefresh />
          </Button>
        }
      />

      <Page>
        {health.error && <OfflineBanner message={`Backend ${backendUrl()} is unreachable — ${health.error}`} onRetry={health.refetch} />}

        {/* ── Signal path ─────────────────────────────────────── */}
        <Card title="Signal path" description="Every hop from the headset to this page.">
          <ol className="grid grid-cols-5 gap-1 sm:gap-2">
            {hops.map((h, i) => (
              <li key={h.label} className="relative flex flex-col items-center gap-2 text-center min-w-0">
                {i > 0 && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-4 right-1/2 w-full h-0.5 -translate-y-1/2 ${h.ok && hops[i - 1].ok ? "bg-secondary" : "bg-outline-variant"}`}
                    style={{ marginRight: "1rem" }}
                  />
                )}
                <span className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full text-base ${
                  h.ok == null ? "bg-surface-container-high text-on-surface-variant" : h.ok ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"
                }`}>
                  {h.ok == null ? <span className="text-xs font-semibold">?</span> : h.ok ? <MdCheck /> : <MdClose />}
                </span>
                <span className="text-xs sm:text-sm font-medium text-on-surface truncate max-w-full">{h.label}</span>
                <span className="sr-only">{h.ok == null ? "unknown" : h.ok ? "ok" : "failed"}</span>
              </li>
            ))}
          </ol>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Devices ───────────────────────────────────────── */}
          <Card title="Network link" className="lg:col-span-2">
            {detail.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                {devices.loading ? "Loading…" : <>No device has connected yet. ESP32 connects to <span className="font-mono">{backendUrl().replace(/^http/, "ws")}/ws?id=&lt;device-id&gt;</span>.</>}
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/50 -my-4">
                {detail.map(d => {
                  const fps = devices.data?.fps[d.id];
                  const audio = d.audio_test;
                  return (
                    <li key={d.id} className="py-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 font-mono text-sm font-semibold text-on-surface"><StatusDot ok={d.connected} pulse />{d.id}</p>
                        <Badge tone={d.connected ? "success" : "error"}>
                          {d.connected ? `Connected${d.connections > 1 ? ` ×${d.connections}` : ""}` : "Disconnected"}
                        </Badge>
                      </div>
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Stat label="WebSocket" value={d.connected ? "open" : "closed"} />
                        <Stat label="Last message" value={formatAgo(d.last_seen, now)} />
                        <Stat label="Last EEG frame" value={formatAgo(d.last_frame_at, now)} />
                        <Stat label="Frames/s" value={d.connected && fps != null ? Math.round(fps).toLocaleString() : "—"} />
                        <Stat label="Total frames" value={(d.frames ?? 0).toLocaleString()} />
                        {audio && (
                          <>
                            <Stat label="Tone" value={audio.on ? `on, ${audio.freq ?? "?"} Hz` : "off"} />
                            <Stat label="Level" value={audio.level_dbfs != null ? `${audio.level_dbfs} dBFS ${audio.ch ?? ""}` : "—"} />
                            <Stat label="ESP uptime" value={audio.uptime_ms != null ? formatDuration(audio.uptime_ms / 1000) : "—"} />
                            <Stat
                              label="Battery"
                              value={audio.bat_pct != null ? `${audio.bat_pct}%${audio.bat_mv != null ? `, ${(audio.bat_mv / 1000).toFixed(2)} V` : ""}` : "not detected"}
                              tone={audio.bat_pct != null && audio.bat_pct <= 15 ? "bad" : undefined}
                            />
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
          <Card title="Acquisition">
            <dl className="divide-y divide-outline-variant/50 -my-2.5">
              <Row label="Backend uptime" value={health.data?.uptime_s != null ? formatDuration(health.data.uptime_s) : "—"} />
              <Row label="Frames since reset" value={(abr.data?.frame_count ?? 0).toLocaleString()} />
              <Row label="Stimuli since reset" value={(abr.data?.stim_count ?? 0).toLocaleString()} />
              <Row label="Trials averaged" value={(abr.data?.trial_count ?? 0).toLocaleString()} />
              <Row label="Stimulus" value={stim.data ? (stim.data.running ? `running, ${stim.data.db} dB` : `idle, ${stim.data.db} dB`) : "—"} />
              <Row label="MongoDB" value={health.data ? (health.data.mongo ? "on" : "off (files only)") : "—"} />
            </dl>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card title="Hardware">
            <dl className="divide-y divide-outline-variant/50 -my-2.5">
              <Row label="ADC" value="ADS1256 + AD620, 24-bit" />
              <Row label="Gain / Vref" value="×24 / 4.5 V" />
              <Row label="Resolution" value="0.0224 µV/LSB" />
              <Row label="Sampling rate" value={abr.data ? `${abr.data.sampling_rate.toLocaleString()} Hz` : "—"} />
              <Row label="Channels" value={abr.data ? `${abr.data.abr_average.length}` : "—"} />
              <Row label="Epoch" value={abr.data ? `${abr.data.epoch_ms} ms (${abr.data.pre_stim_ms ?? 10} pre)` : "—"} />
              <Row label="DAC" value="PCM5102A (I2S)" />
            </dl>
          </Card>

          <Card title="Runtime checks" className="lg:col-span-2">
            <ul className="divide-y divide-outline-variant/50 -my-2">
              {checks.map(c => (
                <li key={c.label} className="flex items-center gap-3 py-2.5">
                  <span aria-hidden="true" className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-sm ${
                    c.state == null ? "bg-surface-container-high text-on-surface-variant" : c.state ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"}`}>
                    {c.state == null ? <span className="text-xs font-semibold">?</span> : c.state ? <MdCheck /> : <MdClose />}
                  </span>
                  <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
                    <p className="text-sm font-medium text-on-surface">{c.label} <span className="sr-only">{c.state == null ? "not checked yet" : c.state ? "ok" : "problem"}</span></p>
                    {c.state === false && <p className="text-sm text-error">{c.warning}</p>}
                    {c.state == null && <p className="text-sm text-on-surface-variant">Not checked yet</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Footer />
      </Page>
    </>
  );
}
