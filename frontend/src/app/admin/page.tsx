"use client";

import { useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import { Card, StatusDot } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, backendUrl, type DummyOptions, type DummyRecording } from "@/lib/api";
import { formatAgo, formatDuration, statusLabel } from "@/lib/abr";
import { useSettings, writeSettings } from "@/lib/settings";
import { MdAdminPanelSettings, MdPlayArrow, MdRefresh, MdScience, MdStop, MdTerminal } from "react-icons/md";

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
        left={
          <>
            <MenuButton />
            <h1 className="flex items-center gap-2 text-lg font-bold text-primary"><MdAdminPanelSettings />Admin</h1>
          </>
        }
        right={<span className="hidden sm:block text-[11px] font-mono text-on-surface-variant">{backendUrl()}</span>}
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-6">
        {/* ── Token ─────────────────────────────────────────── */}
        <Card title="Access token">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={token ?? adminToken}
              onChange={e => setToken(e.target.value)}
              placeholder="LOG_TOKEN (empty if the backend has none)"
              className="flex-1 min-h-10 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
              autoComplete="off"
            />
            <button
              onClick={() => { writeSettings({ adminToken: (token ?? adminToken).trim() }); setToken(null); dummy.refetch(); logs.refetch(); }}
              disabled={token === null}
              className="min-h-10 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold disabled:opacity-40"
            >
              Save token
            </button>
          </div>
          <p className={`mt-2 text-xs ${unauthorized ? "text-error" : "text-on-surface-variant"}`}>
            {unauthorized ? "Backend rejected the token (401). Dummy, command and log endpoints need LOG_TOKEN." : "Stored only in this browser; sent as X-Log-Token."}
          </p>
        </Card>

        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"}`}>
            {msg.text}
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Dummy generator ─────────────────────────────── */}
          <Card title="Dummy data (server)" icon={<MdScience className="text-secondary" />} className="lg:col-span-2">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <StatusDot ok={st ? st.running : null} pulse />
                <span className="font-semibold">{st ? (st.running ? "Running" : "Stopped") : dummy.error ? "Unavailable" : "…"}</span>
                {st?.running && st.started_at && <span className="text-xs text-on-surface-variant">since {formatAgo(st.started_at)}</span>}
              </div>
              {st && (
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Frames sent" value={st.frames.toLocaleString()} />
                  <Stat label="Stimuli sent" value={`${st.stims.toLocaleString()}${st.options.stims ? ` / ${st.options.stims}` : ""}`} />
                  <Stat label="Signal time" value={formatDuration(st.frames / 16000)} />
                  <Stat label="Mode" value={st.recording ? `recording ${st.recording.level_db ?? "?"} dB` : st.options.no_response ? "synthetic, no response" : "synthetic, with ABR"} />
                </dl>
              )}
              {st?.running && st.recording && (
                <p className="text-xs text-on-surface-variant">Ground truth: <span className="font-mono text-on-surface">{truthText(st.recording)}</span></p>
              )}
              {st?.last_error && <p className="text-xs font-mono text-error break-all">DSP: {st.last_error}</p>}

              <fieldset disabled={st?.running || busy} className="grid grid-cols-3 gap-2 text-xs disabled:opacity-60">
                <label className="col-span-3 space-y-1"><span className="text-on-surface-variant">Source</span>
                  <select value={opts.source} onChange={e => pickSource(e.target.value)} className="w-full min-h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-2">
                    <option value={SYNTHETIC}>Synthetic (generated)</option>
                    {recordings.length > 0 && (
                      <optgroup label={`Server recordings${sources.data?.threshold_db != null ? ` (threshold ${sources.data.threshold_db} dB)` : ""}`}>
                        {recordings.map(r => <option key={r.file} value={r.file}>{recordingLabel(r)}</option>)}
                      </optgroup>
                    )}
                  </select>
                  {sources.data?.error && <span className="block text-error font-mono break-all">{sources.data.error}</span>}
                  {selected && <span className="block text-on-surface-variant">Ground truth: <span className="font-mono text-on-surface">{truthText(selected)}</span></span>}
                </label>
                <label className="space-y-1"><span className="text-on-surface-variant">Stimuli (0 = ∞)</span>
                  <input type="number" min={0} step={100} value={opts.stims} onChange={num("stims")} className="w-full min-h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 font-mono" />
                </label>
                <label className="space-y-1"><span className="text-on-surface-variant">Noise (µV RMS)</span>
                  <input type="number" min={0} step={0.5} value={opts.noise_uv} onChange={num("noise_uv")} disabled={!isSynthetic} className="disabled:opacity-50 w-full min-h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 font-mono" />
                </label>
                <label className="space-y-1"><span className="text-on-surface-variant">50 Hz (µV)</span>
                  <input type="number" min={0} step={0.5} value={opts.mains_uv} onChange={num("mains_uv")} disabled={!isSynthetic} className="disabled:opacity-50 w-full min-h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 font-mono" />
                </label>
                <label className="col-span-3 flex items-center gap-2"><input type="checkbox" checked={opts.no_response} disabled={!isSynthetic} onChange={e => setOpts(o => ({ ...o, no_response: e.target.checked }))} />No ABR response (should end as Refer)</label>
                <label className="col-span-3 flex items-center gap-2"><input type="checkbox" checked={opts.reset} onChange={e => setOpts(o => ({ ...o, reset: e.target.checked }))} />Reset the running average first</label>
              </fieldset>

              <div className="flex gap-2">
                {st?.running ? (
                  <button onClick={() => act(api.dummyStop, "Dummy stopped.")} disabled={busy} className="min-h-10 flex items-center gap-1.5 px-4 rounded-lg bg-error text-on-error text-xs font-bold disabled:opacity-60">
                    <MdStop className="text-lg" />Stop dummy
                  </button>
                ) : (
                  <button onClick={() => act(() => api.dummyStart(opts), "Dummy started — watch it on Start Scan or below.")} disabled={busy || !!dummy.error} className="min-h-10 flex items-center gap-1.5 px-4 rounded-lg bg-secondary text-on-secondary text-xs font-bold disabled:opacity-50">
                    <MdPlayArrow className="text-lg" />Play dummy
                  </button>
                )}
                <button onClick={() => act(api.reset, "Average reset.")} disabled={busy} className="min-h-10 flex items-center gap-1.5 px-3 rounded-lg border border-outline-variant text-xs font-bold text-primary disabled:opacity-50">
                  <MdRefresh className="text-lg" />Reset average
                </button>
              </div>
              <p className="text-[11px] text-on-surface-variant">
                The backend runs DSP in a new Python process per trial (~2–3 trials/s), so the dummy runs slower than real time.
              </p>
            </div>
          </Card>

          {/* ── Live result ─────────────────────────────────── */}
          <Card title="Current average" className="lg:col-span-3" action={<Link href="/scan" className="text-xs font-bold text-primary hover:underline">Open live scan →</Link>}>
            {r ? (
              <div className="space-y-3">
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Stat label="Trials" value={r.trial_count.toLocaleString()} />
                  <Stat label="Status" value={statusLabel(r.status ?? r.quality)} />
                  <Stat label="SNR Ch 1" value={`${(r.snr?.[0] ?? 0).toFixed(1)} dB`} />
                  <Stat label="Verdict" value={r.analysis?.verdict ?? "—"} />
                </dl>
                <ABRWaveformChart data={r} range={[0, 10]} height={220} />
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">{abr.error ?? "Loading…"}</p>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Command ─────────────────────────────────────── */}
          <Card title="Send command to ESP32" icon={<MdTerminal className="text-secondary" />} className="lg:col-span-2">
            <form
              className="space-y-2"
              onSubmit={e => { e.preventDefault(); if (cmd.trim()) act(() => api.command(device, cmd.trim()), `Sent "${cmd.trim()}" to ${device || "all devices"}.`); }}
            >
              <select value={device} onChange={e => setDevice(e.target.value)} className="w-full min-h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 text-sm font-mono">
                <option value="">All devices</option>
                {(devs.data?.devices ?? []).map(id => <option key={id} value={id}>{id}</option>)}
              </select>
              <div className="flex gap-2">
                <input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="e.g. on, off, l -30, f 1000, ?" className="flex-1 min-h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm font-mono" />
                <button type="submit" disabled={busy || !cmd.trim()} className="min-h-10 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold disabled:opacity-40">Send</button>
              </div>
            </form>
          </Card>

          {/* ── Logs ────────────────────────────────────────── */}
          <Card title="Device logs" className="lg:col-span-3" action={<a href={`${backendUrl()}/logs`} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary hover:underline">Full log page →</a>}>
            <div className="h-64 overflow-y-auto rounded-lg bg-surface-container-low border border-outline-variant p-2 font-mono text-[11px] leading-5">
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
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-low px-3 py-2">
      <dt className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">{label}</dt>
      <dd className="font-mono tabular-nums font-semibold mt-0.5">{value}</dd>
    </div>
  );
}
