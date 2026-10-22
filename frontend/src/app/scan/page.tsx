"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import RawWaveformChart from "@/components/RawWaveformChart";
import FrameLog from "@/components/FrameLog";
import { OfflineBanner, StatusDot } from "@/components/ui";
import { useABRStream } from "@/hooks/useABRStream";
import { useBackend } from "@/hooks/useBackend";
import { api, backendUrl, type Ear } from "@/lib/api";
import { MIN_TRIALS, SNR_GOOD_DB, formatAgo, statusLabel, validWaves } from "@/lib/abr";
import { useSettings } from "@/lib/settings";
import {
  MdAdd, MdPause, MdPlayArrow, MdRefresh, MdRemove, MdSave, MdScience, MdStop, MdVolumeUp,
} from "react-icons/md";

type Tab = "abr" | "raw";
type Range = "abr" | "full";

const DB_MIN = 40, DB_MAX = 90, DB_STEP = 10;

export default function ScanPage() {
  const router   = useRouter();
  const settings = useSettings();
  const stream   = useABRStream();
  const { status, abrResult, prevResult, raw, packets, lastPacketAt, paused, setPaused, simulation, setSimulation, clearLocal } = stream;

  const isLive  = status === "live";
  const devices = useBackend(api.devices, 5_000);
  const stim    = useBackend(api.stim, 3_000);

  const [tab, setTab]           = useState<Tab>("abr");
  const [range, setRange]       = useState<Range>("abr");
  const [showCh2, setShowCh2]   = useState(false);
  const [showGhost, setShowGhost] = useState(true);
  const [ear, setEar]           = useState<Ear>("left");
  const [pendingDb, setPendingDb] = useState<number | null>(null);
  const [busy, setBusy]         = useState<null | "start" | "stop" | "db" | "reset" | "save">(null);
  const [message, setMessage]   = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [now, setNow]           = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deviceList = devices.data?.devices ?? [];
  const deviceName = deviceList[0] ?? null;
  const stimRunning = isLive && !!stim.data?.running;
  const db = pendingDb ?? stim.data?.db ?? settings.stimDb;

  const trials   = abrResult.trial_count;
  const target   = Math.max(MIN_TRIALS, settings.targetTrials);
  const snr      = abrResult.snr ?? [];
  const waves    = validWaves(abrResult.analysis?.waves);
  const ivInt    = waves.length ? abrResult.analysis?.interpeak_ms?.["I-V"] : undefined;
  const canSave  = isLive && trials >= MIN_TRIALS && busy !== "save";

  async function run<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>, ok?: (r: T) => string | void) {
    setBusy(kind);
    setMessage(null);
    try {
      const r = await fn();
      const text = ok?.(r);
      if (text) setMessage({ kind: "info", text });
      return r;
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const startStim = () => run("start", api.stimStart, r => {
    stim.refetch();
    return r.sent === 0 ? "Stimulus marked as running, but no ESP32 is connected to receive the command." : undefined;
  });
  const stopStim = () => run("stop", api.stimStop, () => { stim.refetch(); });

  async function changeDb(next: number) {
    const v = Math.min(DB_MAX, Math.max(DB_MIN, next));
    setPendingDb(v);
    await run("db", () => api.setDB(v), () => { stim.refetch(); });
    setPendingDb(null);
  }

  async function resetAverage() {
    if (simulation) { clearLocal(); return; }
    await run("reset", api.reset, () => { clearLocal(); });
  }

  const savingRef = useRef(false);
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    const r = await run("save", () => api.saveSession({ ear, device: deviceName ?? undefined, stim_db: db }));
    savingRef.current = false;
    if (r?.file) router.push(`/results?file=${encodeURIComponent(r.file)}`);
  }

  // Terapkan level default dari Settings sekali saat halaman dibuka (hanya kalau stimulus belum jalan)
  const dbSyncedRef = useRef(false);
  useEffect(() => {
    if (dbSyncedRef.current || !isLive || !stim.data) return;
    dbSyncedRef.current = true;
    if (!stim.data.running && stim.data.db !== settings.stimDb) {
      api.setDB(settings.stimDb).then(() => stim.refetch()).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, stim.data, settings.stimDb]);

  // Auto-save sekali saat target trial tercapai (Settings → Scan defaults)
  const autoSavedRef = useRef(false);
  useEffect(() => {
    if (trials < target) autoSavedRef.current = false;
    if (!settings.autoSave || !isLive || autoSavedRef.current || trials < target) return;
    autoSavedRef.current = true;
    void save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trials, target, settings.autoSave, isLive]);

  const badge = paused
    ? { text: "PAUSED", cls: "bg-surface-container-high text-on-surface-variant" }
    : status === "live"
      ? { text: stimRunning ? "LIVE · STIM ON" : "LIVE", cls: "bg-error text-on-error" }
      : status === "simulation"
        ? { text: "SIMULATION", cls: "bg-tertiary-fixed text-on-tertiary-fixed-variant" }
        : status === "connecting"
          ? { text: "CONNECTING…", cls: "bg-surface-container-high text-on-surface-variant" }
          : { text: "OFFLINE", cls: "bg-error-container text-on-error-container" };

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div className="flex items-center gap-3 min-w-0">
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider ${badge.cls}`}>
                {status === "live" && !paused && <span className="w-2 h-2 rounded-full bg-on-error pulse-red" />}
                {badge.text}
              </span>
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-on-surface-variant truncate">
                <StatusDot ok={simulation ? null : !!deviceName} />
                <span className="font-mono truncate">{simulation ? "simulated device" : deviceName ?? "no device"}</span>
              </span>
            </div>
          </>
        }
        right={
          <div className="hidden md:flex items-center gap-4 text-xs text-on-surface-variant font-mono tabular-nums">
            <span>Trials <strong className="text-primary">{trials.toLocaleString()}</strong></span>
            <span>Stim <strong className="text-primary">{(abrResult.stim_count ?? 0).toLocaleString()}</strong></span>
            <span>SNR <strong className={(snr[0] ?? 0) >= SNR_GOOD_DB ? "text-secondary" : "text-primary"}>{(snr[0] ?? 0).toFixed(1)} dB</strong></span>
          </div>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-6">
        {/* ── Header + controls ──────────────────────────────── */}
        <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-primary">Auditory Brainstem Response</h1>
            <p className="text-sm text-on-surface-variant">
              Tone burst · {db} dB · {ear === "left" ? "Left" : "Right"} ear · {abrResult.sampling_rate / 1000} kHz, epoch {abrResult.epoch_ms} ms
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Ear */}
            <div className="flex rounded-lg border border-outline-variant overflow-hidden" role="group" aria-label="Ear">
              {(["left", "right"] as Ear[]).map(e => (
                <button
                  key={e}
                  onClick={() => setEar(e)}
                  aria-pressed={ear === e}
                  className={`min-h-10 px-3 text-xs font-bold ${ear === e ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low"}`}
                >
                  {e === "left" ? "Left" : "Right"}
                </button>
              ))}
            </div>

            {/* Level */}
            <div className="flex items-center rounded-lg border border-outline-variant bg-surface-container-lowest" aria-label="Stimulus level">
              <button onClick={() => changeDb(db - DB_STEP)} disabled={!isLive || db <= DB_MIN || busy === "db"} className="min-h-10 px-2.5 text-on-surface-variant disabled:opacity-40" aria-label="Lower level">
                <MdRemove />
              </button>
              <span className="px-1 text-xs font-bold font-mono tabular-nums flex items-center gap-1 text-primary">
                <MdVolumeUp className="text-on-surface-variant" />{db} dB
              </span>
              <button onClick={() => changeDb(db + DB_STEP)} disabled={!isLive || db >= DB_MAX || busy === "db"} className="min-h-10 px-2.5 text-on-surface-variant disabled:opacity-40" aria-label="Raise level">
                <MdAdd />
              </button>
            </div>

            {stimRunning ? (
              <button onClick={stopStim} disabled={busy === "stop"} className="min-h-10 flex items-center gap-1.5 px-4 rounded-lg bg-error text-on-error text-xs font-bold hover:opacity-90 disabled:opacity-60">
                <MdStop className="text-lg" />Stop stimulus
              </button>
            ) : (
              <button onClick={startStim} disabled={!isLive || busy === "start"} className="min-h-10 flex items-center gap-1.5 px-4 rounded-lg bg-secondary text-on-secondary text-xs font-bold hover:opacity-90 disabled:opacity-50">
                <MdPlayArrow className="text-lg" />Start stimulus
              </button>
            )}

            <button onClick={() => setPaused(!paused)} className="min-h-10 flex items-center gap-1.5 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-primary text-xs font-bold hover:bg-surface-container-low" title="Freeze the display; acquisition keeps running">
              {paused ? <MdPlayArrow className="text-lg" /> : <MdPause className="text-lg" />}
              {paused ? "Resume view" : "Pause view"}
            </button>

            <button onClick={resetAverage} disabled={busy === "reset" || (!isLive && !simulation)} className="min-h-10 flex items-center gap-1.5 px-3 rounded-lg text-on-surface-variant text-xs font-bold hover:bg-surface-container-low disabled:opacity-50">
              <MdRefresh className="text-lg" />Reset average
            </button>

            <button
              onClick={save}
              disabled={!canSave}
              title={simulation ? "Simulated data cannot be saved" : trials < MIN_TRIALS ? `Needs at least ${MIN_TRIALS} trials` : undefined}
              className="min-h-10 flex items-center gap-1.5 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold hover:opacity-90 disabled:opacity-40"
            >
              <MdSave className="text-lg" />{busy === "save" ? "Saving…" : "Save session"}
            </button>
          </div>
        </section>

        {status === "offline" && (
          <div className="space-y-2">
            <OfflineBanner message={`Backend ${backendUrl()} is unreachable. Retrying every 5 s.`} />
            <button onClick={() => setSimulation(true)} className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline">
              <MdScience />Run a simulation instead
            </button>
          </div>
        )}
        {simulation && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-on-tertiary-container/40 bg-tertiary-fixed/50 px-4 py-3 text-sm text-on-tertiary-fixed-variant">
            <p><strong>Simulation mode.</strong> Synthetic ABR (Wave I/III/V at 1.6/3.7/5.6 ms) plus noise — not real data, cannot be saved.</p>
            <button onClick={() => setSimulation(false)} className="shrink-0 min-h-9 px-3 rounded-lg bg-surface-container-lowest text-xs font-bold text-primary">Back to live</button>
          </div>
        )}
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${message.kind === "error" ? "bg-error-container text-on-error-container" : "bg-surface-container text-on-surface"}`}>
            {message.text}
          </p>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* ── Chart ───────────────────────────────────────── */}
          <section className="col-span-12 lg:col-span-9 bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 md:p-6 min-w-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant mb-4">
              {([["abr", "ABR Average"], ["raw", "Raw EEG"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-2.5 text-xs font-bold border-b-2 -mb-px ${tab === key ? "border-secondary text-secondary" : "border-transparent text-on-surface-variant hover:text-primary"}`}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto pb-2 text-[11px] text-on-surface-variant font-mono tabular-nums">
                {lastPacketAt ? `last packet ${formatAgo(new Date(lastPacketAt).toISOString(), now)}` : "no packets yet"}
              </span>
            </div>

            {tab === "abr" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-on-surface-variant">
                  <div className="flex rounded-md border border-outline-variant overflow-hidden">
                    {([["abr", "0–10 ms"], ["full", "Full epoch"]] as const).map(([key, label]) => (
                      <button key={key} onClick={() => setRange(key)} aria-pressed={range === key}
                        className={`px-2.5 py-1 font-bold ${range === key ? "bg-primary text-on-primary" : "hover:bg-surface-container-low"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-secondary" />Ch 1</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={showCh2} onChange={e => setShowCh2(e.target.checked)} />
                    <span className="inline-block w-5 h-0.5 bg-primary-container" />Ch 2
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={showGhost} onChange={e => setShowGhost(e.target.checked)} />
                    <span className="inline-block w-5 h-0.5 bg-outline opacity-60" />Previous snapshot
                  </label>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-3 rounded-sm bg-secondary-container" />Wave V window (5–7.5 ms)</span>
                </div>
                <ABRWaveformChart
                  data={abrResult}
                  channels={showCh2 ? [0, 1] : [0]}
                  ghost={showGhost ? prevResult?.abr_average?.[0] ?? null : null}
                  range={range === "abr" ? [0, 10] : [-(abrResult.pre_stim_ms ?? 10), abrResult.epoch_ms - (abrResult.pre_stim_ms ?? 10)]}
                  height={300}
                />
                <p className="text-xs text-on-surface-variant">
                  A clear peak around 5–7 ms that keeps growing as trials increase means the ear responded.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-on-surface-variant">
                  Last {Math.round((raw.ch1.length / raw.fs) * 1000)} ms · {raw.fs / 1000} kHz · centred on mean · dashed lines = stimulus markers
                </p>
                <RawWaveformChart raw={raw} height={300} />
              </div>
            )}
          </section>

          {/* ── Scan health ─────────────────────────────────── */}
          <aside className="col-span-12 lg:col-span-3 space-y-4">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 space-y-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Trials</h2>
              <p className="text-4xl font-bold text-primary tabular-nums">{trials.toLocaleString()}</p>
              <div className="relative h-2.5 rounded-full bg-surface-container-high overflow-hidden" aria-label={`${trials} of ${target} trials`}>
                <div className={`h-full ${trials >= target ? "bg-secondary" : trials >= MIN_TRIALS ? "bg-on-tertiary-container" : "bg-outline"}`} style={{ width: `${Math.min(100, (trials / target) * 100)}%` }} />
                <span className="absolute top-0 h-full w-px bg-on-surface/50" style={{ left: `${(MIN_TRIALS / target) * 100}%` }} />
              </div>
              <p className="text-xs text-on-surface-variant">
                {trials < MIN_TRIALS ? `Insufficient — ${MIN_TRIALS - trials} more to reach ${MIN_TRIALS}` : trials < target ? `Inconclusive — target ${target}` : "Target reached"}
              </p>
              <dl className="grid grid-cols-2 gap-2 pt-2 border-t border-outline-variant/60 text-xs">
                <dt className="text-on-surface-variant">Stimuli</dt>
                <dd className="text-right font-mono tabular-nums">{(abrResult.stim_count ?? 0).toLocaleString()}</dd>
                <dt className="text-on-surface-variant">Frames</dt>
                <dd className="text-right font-mono tabular-nums">{(abrResult.frame_count ?? 0).toLocaleString()}</dd>
              </dl>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Signal</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  abrResult.status === "Konvergen" ? "bg-secondary-container text-on-secondary-container"
                  : abrResult.status === "Terbentuk" ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                  : "bg-surface-container-high text-on-surface-variant"}`}>
                  {statusLabel(abrResult.status ?? abrResult.quality)}
                </span>
              </div>
              {[0, 1].map(ch => {
                const v = snr[ch] ?? 0;
                return (
                  <div key={ch}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold">SNR Ch {ch + 1}</span>
                      <span className={`font-mono tabular-nums font-bold ${v >= SNR_GOOD_DB ? "text-secondary" : "text-on-surface-variant"}`}>{v.toFixed(1)} dB</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-surface-container-high overflow-hidden">
                      <div className={`h-full ${v >= SNR_GOOD_DB ? "bg-secondary" : "bg-outline"}`} style={{ width: `${Math.max(0, Math.min(100, (v / 12) * 100))}%` }} />
                      <span className="absolute top-0 h-full w-px bg-on-surface/50" style={{ left: `${(SNR_GOOD_DB / 12) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between text-xs pt-2 border-t border-outline-variant/60">
                <span className="text-on-surface-variant">Pearson r (stability)</span>
                <span className="font-mono tabular-nums font-bold">{(abrResult.pearson_r ?? 0).toFixed(3)}</span>
              </div>
            </div>

            <div className="bg-primary-container text-primary-fixed rounded-2xl p-5 space-y-2">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-on-primary-container">Latencies</h2>
              {(["I", "III", "V"] as const).map(name => {
                const w = waves.find(x => x.name === name);
                return (
                  <div key={name} className="flex items-baseline justify-between bg-white/5 rounded-lg px-3 py-2">
                    <span className="text-sm font-bold">Wave {name}</span>
                    <span className="font-mono tabular-nums text-lg font-bold">{w ? w.latency_ms.toFixed(2) : "—"}<span className="text-xs font-normal opacity-70"> ms</span></span>
                  </div>
                );
              })}
              <div className="flex items-baseline justify-between rounded-lg px-3 py-2 bg-secondary-container text-on-secondary-container">
                <span className="text-sm font-bold">I–V interval</span>
                <span className="font-mono tabular-nums text-lg font-bold">{ivInt != null ? ivInt.toFixed(2) : "—"}<span className="text-xs font-normal opacity-70"> ms</span></span>
              </div>
            </div>
          </aside>
        </div>

        <details className="bg-surface-container-lowest border border-outline-variant rounded-2xl">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-primary">
            Packet log <span className="font-normal text-on-surface-variant">— raw stream packets (every 200 ms)</span>
          </summary>
          <div className="px-5 pb-5"><FrameLog packets={packets} /></div>
        </details>
      </main>
    </>
  );
}
