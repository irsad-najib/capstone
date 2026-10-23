"use client";

import { useState } from "react";
import TopBar from "@/components/TopBar";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import { Button, ButtonLink, Card, Notice, Page, Stat, StatusDot, inputClass } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, backendUrl, type DummyOptions, type DummyRecording } from "@/lib/api";
import { formatAgo, formatDuration, statusLabel } from "@/lib/abr";
import { useSettings, writeSettings } from "@/lib/settings";
import { MdArrowForward, MdOpenInNew, MdPlayArrow, MdRefresh, MdStop } from "react-icons/md";

const SYNTHETIC = "synthetic";
const DEFAULT_OPTS: Required<DummyOptions> = { source: SYNTHETIC, stims: 600, noise_uv: 4, mains_uv: 1.5, no_response: false, reset: true };

const recordingLabel = (r: DummyRecording) =>
  `${r.level_db ?? "?"} dB · ${r.sweeps.toLocaleString()} sweeps · ${Math.round(r.duration_s)} s`;

const truthText = (r?: DummyRecording | null) => {
  const w = r?.ground_truth?.waves;
  if (!w || Object.keys(w).length === 0) return "no response (below threshold)";
  return ["I", "III", "V"].filter(k => w[k]).map(k => `${k} ${w[k].latency_ms.toFixed(2)} ms`).join(" · ");
};

export default function AdminPage() {
  const { adminToken } = useSettings();
  const [token, setToken] = useState<string | null>(null);

  const dummy = useBackend(api.dummy, 1_000);
  const sources = useBackend(api.dummySources, 60_000);
  const abr   = useBackend(api.abrResult, 2_000);
  const devs  = useBackend(api.devices, 5_000);
  const logs  = useBackend(api.logs, 3_000);

  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [device, setDevice] = useState("");
  const [cmd, setCmd]   = useState("");

  const unauthorized = [dummy.error, logs.error].some(e => e?.toLowerCase().includes("unauthorized"));
  const st = dummy.data;
  const recordings = sources.data?.recordings ?? [];
  const selected = recordings.find(r => r.file === opts.source);
  const isSynthetic = opts.source === SYNTHETIC;
  const pickSource = (source: string) => {
    const rec = recordings.find(r => r.file === source);
    setOpts(o => ({ ...o, source, stims: rec ? rec.sweeps : DEFAULT_OPTS.stims }));
  };
  const r = abr.data;

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      dummy.refetch();
      abr.refetch();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const num = (k: "stims" | "noise_uv" | "mains_uv") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOpts(o => ({ ...o, [k]: Math.max(0, Number(e.target.value) || 0) }));

  return (
    <>
      <TopBar
        title="Admin"
      />

      <Page>
        {/* ── Token ─────────────────────────────────────────── */}
        <Card title="Access token" description={unauthorized ? undefined : "Stored only in this browser and sent as X-Log-Token."}>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              aria-label="Access token"
              value={token ?? adminToken}
              onChange={e => setToken(e.target.value)}
              placeholder="LOG_TOKEN (empty if the backend has none)"
              className={`${inputClass} font-mono sm:flex-1`}
              autoComplete="off"
            />
            <Button
              variant="primary"
              onClick={() => { writeSettings({ adminToken: (token ?? adminToken).trim() }); setToken(null); dummy.refetch(); logs.refetch(); }}
              disabled={token === null}
            >
              Save token
            </Button>
          </div>
          {unauthorized && <p className="mt-2 text-sm text-error">The backend rejected the token (401). Dummy, command and log endpoints need LOG_TOKEN.</p>}
        </Card>

        {msg && <Notice kind={msg.ok ? "success" : "error"}>{msg.text}</Notice>}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Dummy generator ─────────────────────────────── */}
          <Card
            title="Dummy data"
            description="Replays synthetic or recorded ABR through the backend."
            className="lg:col-span-2"
            action={
              <span className="flex items-center gap-2 text-sm">
                <StatusDot ok={st ? st.running : null} pulse />
                <span className="font-medium text-on-surface">{st ? (st.running ? "Running" : "Stopped") : dummy.error ? "Unavailable" : "…"}</span>
              </span>
            }
          >
            <div className="space-y-4">
              {st && (
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Frames sent" value={st.frames.toLocaleString()} />
                  <Stat label="Stimuli sent" value={`${st.stims.toLocaleString()}${st.options.stims ? ` / ${st.options.stims}` : ""}`} />
                  <Stat label="Signal time" value={formatDuration(st.frames / 16000)} />
                  <Stat label="Mode" value={st.recording ? `recording ${st.recording.level_db ?? "?"} dB` : st.options.no_response ? "synthetic, no response" : "synthetic, with ABR"} />
                </dl>
              )}
              {st?.running && st.started_at && <p className="text-xs text-on-surface-variant">Started {formatAgo(st.started_at)}.</p>}
              {st?.running && st.recording && (
                <p className="text-xs text-on-surface-variant">Ground truth: <span className="font-mono text-on-surface">{truthText(st.recording)}</span></p>
              )}
              {st?.last_error && <p className="text-xs font-mono text-error break-all">DSP: {st.last_error}</p>}

              <fieldset disabled={st?.running || busy} className="grid grid-cols-3 gap-3 text-sm disabled:opacity-60">
                <label className="col-span-3 space-y-1.5"><span className="text-on-surface-variant text-xs">Source</span>
                  <select value={opts.source} onChange={e => pickSource(e.target.value)} className={inputClass}>
                    <option value={SYNTHETIC}>Synthetic (generated)</option>
                    {recordings.length > 0 && (
                      <optgroup label={`Server recordings${sources.data?.threshold_db != null ? ` (threshold ${sources.data.threshold_db} dB)` : ""}`}>
                        {recordings.map(r => <option key={r.file} value={r.file}>{recordingLabel(r)}</option>)}
                      </optgroup>
                    )}
                  </select>
                  {sources.data?.error && <span className="block text-xs text-error font-mono break-all">{sources.data.error}</span>}
                  {selected && <span className="block text-xs text-on-surface-variant">Ground truth: <span className="font-mono text-on-surface">{truthText(selected)}</span></span>}
                </label>
                <label className="space-y-1.5"><span className="text-on-surface-variant text-xs">Stimuli (0 = ∞)</span>
                  <input type="number" min={0} step={100} value={opts.stims} onChange={num("stims")} className={`${inputClass} px-2 font-mono`} />
                </label>
                <label className="space-y-1.5"><span className="text-on-surface-variant text-xs">Noise (µV RMS)</span>
                  <input type="number" min={0} step={0.5} value={opts.noise_uv} onChange={num("noise_uv")} disabled={!isSynthetic} className={`${inputClass} px-2 font-mono`} />
                </label>
                <label className="space-y-1.5"><span className="text-on-surface-variant text-xs">50 Hz (µV)</span>
                  <input type="number" min={0} step={0.5} value={opts.mains_uv} onChange={num("mains_uv")} disabled={!isSynthetic} className={`${inputClass} px-2 font-mono`} />
                </label>
                <label className="col-span-3 flex items-center gap-2"><input type="checkbox" className="accent-primary" checked={opts.no_response} disabled={!isSynthetic} onChange={e => setOpts(o => ({ ...o, no_response: e.target.checked }))} />No ABR response (should end as Refer)</label>
                <label className="col-span-3 flex items-center gap-2"><input type="checkbox" className="accent-primary" checked={opts.reset} onChange={e => setOpts(o => ({ ...o, reset: e.target.checked }))} />Reset the running average first</label>
              </fieldset>

              <div className="flex gap-2">
                {st?.running ? (
                  <Button variant="danger" onClick={() => act(api.dummyStop, "Dummy stopped.")} disabled={busy}><MdStop />Stop dummy</Button>
                ) : (
                  <Button variant="secondary" onClick={() => act(() => api.dummyStart(opts), "Dummy started — watch it on Start Scan or below.")} disabled={busy || !!dummy.error}><MdPlayArrow />Play dummy</Button>
                )}
                <Button variant="outline" onClick={() => act(api.reset, "Average reset.")} disabled={busy}><MdRefresh />Reset average</Button>
              </div>
              <p className="text-xs text-on-surface-variant">
                The backend runs DSP in a new Python process per trial (~2–3 trials/s), so the dummy runs slower than real time.
              </p>
            </div>
          </Card>

          {/* ── Live result ─────────────────────────────────── */}
          <Card title="Current average" className="lg:col-span-3" action={<ButtonLink href="/scan" variant="ghost" size="sm">Open live scan<MdArrowForward /></ButtonLink>}>
            {r ? (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Trials" value={r.trial_count.toLocaleString()} />
                  <Stat label="Status" value={statusLabel(r.status ?? r.quality)} />
                  <Stat label="SNR Ch 1" value={`${(r.snr?.[0] ?? 0).toFixed(1)} dB`} />
                  <Stat label="Verdict" value={r.analysis?.verdict ?? "—"} />
                </dl>
                <ABRWaveformChart data={r} range={[0, 10]} height={240} />
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">{abr.error ?? "Loading…"}</p>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Command ─────────────────────────────────────── */}
          <Card title="Send command to ESP32" description="Same commands as the serial console." className="lg:col-span-2">
            <form
              className="space-y-2"
              onSubmit={e => { e.preventDefault(); if (cmd.trim()) act(() => api.command(device, cmd.trim()), `Sent "${cmd.trim()}" to ${device || "all devices"}.`); }}
            >
              <select aria-label="Device" value={device} onChange={e => setDevice(e.target.value)} className={`${inputClass} font-mono`}>
                <option value="">All devices</option>
                {(devs.data?.devices ?? []).map(id => <option key={id} value={id}>{id}</option>)}
              </select>
              <div className="flex gap-2">
                <input aria-label="Command" value={cmd} onChange={e => setCmd(e.target.value)} placeholder="on, off, l -30, f 1000, ?" className={`${inputClass} font-mono flex-1`} />
                <Button type="submit" variant="primary" disabled={busy || !cmd.trim()}>Send</Button>
              </div>
            </form>
          </Card>

          {/* ── Logs ────────────────────────────────────────── */}
          <Card
            title="Device logs"
            className="lg:col-span-3"
            action={<a href={`${backendUrl()}/logs`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Full log page<MdOpenInNew /></a>}
          >
            <div className="h-64 overflow-y-auto rounded-xl bg-surface-container-low p-3 font-mono text-[11px] leading-5">
              {logs.error ? (
                <p className="text-error">{logs.error}</p>
              ) : (logs.data?.lines ?? []).length === 0 ? (
                <p className="text-on-surface-variant">No log lines yet.</p>
              ) : (
                [...(logs.data?.lines ?? [])].reverse().map((l, i) => (
                  <p key={`${l.t}-${i}`} className="whitespace-pre-wrap break-all">
                    <span className="text-on-surface-variant">{l.t.slice(11, 23)}</span> <span className="text-secondary">{l.device}</span> {l.line}
                  </p>
                ))
              )}
            </div>
          </Card>
        </div>
      </Page>
    </>
  );
}
