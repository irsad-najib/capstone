"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import RawWaveformChart from "@/components/RawWaveformChart";
import FrameLog from "@/components/FrameLog";
import {
  Badge, Button, Card, Notice, OfflineBanner, OutcomeChip, Page, Segmented, Stat, StatusDot,
} from "@/components/ui";
import { useABRStream } from "@/hooks/useABRStream";
import { useBackend } from "@/hooks/useBackend";
import { api, backendUrl, type ABRResult, type Ear } from "@/lib/api";
import { MIN_TRIALS, SNR_GOOD_DB, formatAgo, outcomeOf, preStimMs, statusLabel, validWaves } from "@/lib/abr";
import { INTERAURAL_V_MAX_MS, addEarResult, clearEar, clearEarSlots, interauralV, thresholdOf, useEarSlots, type EarResult, type EarSlots } from "@/lib/earSlots";
import { useSettings } from "@/lib/settings";
import {
  MdAdd, MdPause, MdPersonAdd, MdPlayArrow, MdRefresh, MdRemove, MdSave, MdScience, MdStop,
} from "react-icons/md";

type Tab = "abr" | "raw";
type Range = "abr" | "full";
/** "both" = kiri lalu kanan otomatis, "single" = satu telinga saja (tes ulang / lanjutkan). */
type RunMode = "both" | "single";
/** Tes yang sedang berjalan: telinga, daftar level (tinggi → rendah), dan level ke berapa. */
interface Job { mode: RunMode; ear: Ear; levels: number[]; idx: number }

const DB_MIN = 20, DB_MAX = 90, DB_STEP = 10;
const EARS: Ear[] = ["right", "left"];   // urutan tes: kanan dulu, lalu kiri
const EAR_NAME: Record<Ear, string> = { left: "Left ear", right: "Right ear" };
/** Abaikan target trial sebentar setelah reset: paket SSE lama bisa masih membawa hitungan lama. */
const SETTLE_MS = 5000;
/** Waktu sekarang; di luar komponen supaya tidak dianggap dipanggil saat render. */
const nowMs = () => Date.now();

/** Ringkasan rata-rata saat disimpan, untuk panel telinga. */
function toEarResult(r: ABRResult, file: string, stimDb: number): EarResult {
  return {
    file,
    saved_at: new Date().toISOString(),
    outcome: outcomeOf({ trial_count: r.trial_count, status: r.status ?? r.quality, verdict: r.analysis?.verdict }),
    trials: r.trial_count,
    stim_db: stimDb,
    snr: r.snr?.[0],
    wave_v_ms: validWaves(r.analysis?.waves).find(w => w.name === "V")?.latency_ms,
    chart: {
      abr_average: [r.abr_average?.[0] ?? []],
      sampling_rate: r.sampling_rate,
      epoch_ms: r.epoch_ms,
      pre_stim_ms: preStimMs(r),
      trial_count: r.trial_count,
      analysis: r.analysis,
    },
  };
}

export default function ScanPage() {
  const settings = useSettings();
  const stream   = useABRStream();
  const { status, abrResult, prevResult, raw, packets, lastPacketAt, paused, setPaused, simulation, setSimulation, clearLocal } = stream;
  const slots    = useEarSlots();

  const isLive  = status === "live";
  const devices = useBackend(api.devices, 5_000);
  const stim    = useBackend(api.stim, 3_000);

  const [tab, setTab]           = useState<Tab>("abr");
  const [range, setRange]       = useState<Range>("abr");
  const [showCh2, setShowCh2]   = useState(false);
  const [showGhost, setShowGhost] = useState(true);
  const [ear, setEar]           = useState<Ear>("right");
  const [job, setJob]           = useState<Job | null>(null);
  const [routeWarn, setRouteWarn] = useState(false);
  const [pendingDb, setPendingDb] = useState<number | null>(null);
  const [busy, setBusy]         = useState<null | "start" | "stop" | "db" | "reset" | "save">(null);
  const [message, setMessage]   = useState<{ kind: "error" | "info" | "success"; text: string } | null>(null);
  const [now, setNow]           = useState(() => Date.now());

  // Dibaca di dalam alur async, jadi disimpan juga di ref.
  const jobRef      = useRef<Job | null>(null);
  const earStartRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deviceList = devices.data?.devices ?? [];
  const deviceName = deviceList[0] ?? null;
  const battery = devices.data?.detail?.find(d => d.id === deviceName)?.audio_test?.bat_pct;
  const stimRunning = isLive && !!stim.data?.running;
  const db = pendingDb ?? stim.data?.db ?? settings.stimDb;

  const levels   = [...settings.testLevels].sort((a, b) => b - a);
  const trials   = abrResult.trial_count;
  const target   = Math.max(MIN_TRIALS, settings.targetTrials);
  const snr      = abrResult.snr ?? [];
  const waves    = validWaves(abrResult.analysis?.waves);
  const ivInt    = waves.length ? abrResult.analysis?.interpeak_ms?.["I-V"] : undefined;
  const testing  = job !== null;
  const canSave  = isLive && trials >= MIN_TRIALS && busy !== "save";
  const done     = (e: Ear) => slots[e].length > 0;
  const bothDone = done("left") && done("right");
  // Tes yang terhenti di tengah: lanjutkan telinga yang belum, tanpa menghapus hasil yang sudah ada.
  const nextEar: Ear | null = !done("right") ? (done("left") ? "right" : null) : !done("left") ? "left" : null;

  async function act<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>, ok?: (r: T) => string | void) {
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

  async function changeDb(next: number) {
    const v = Math.min(DB_MAX, Math.max(DB_MIN, next));
    setPendingDb(v);
    await act("db", () => api.setDB(v), () => { stim.refetch(); });
    setPendingDb(null);
  }

  async function resetAverage() {
    if (simulation) { clearLocal(); return; }
    await act("reset", api.reset, () => { clearLocal(); });
  }

  /** Arahkan bunyi ke satu telinga (perintah konsol ESP32 "c L" / "c R"). */
  async function routeEar(e: Ear) {
    try {
      const r = await api.command(deviceName ?? "", e === "left" ? "c L" : "c R");
      setRouteWarn(r.sent === 0);
    } catch {
      setRouteWarn(true);
    }
  }

  /** Mulai satu level: rata-rata baru, bunyi ke telinga itu di level itu, stimulus jalan. */
  async function beginLevel(j: Job) {
    jobRef.current = j;
    setJob(j);
    setEar(j.ear);
    await api.reset().catch(() => {});
    clearLocal();
    earStartRef.current = nowMs();
    await routeEar(j.ear);
    await api.setDB(j.levels[j.idx]).catch(() => {});
    await act("start", api.stimStart, r => {
      stim.refetch();
      return r.sent === 0 ? "No ESP32 is connected to play the sound. Connect the device, then start again." : undefined;
    });
  }

  function startTest() {
    clearEarSlots();
    void beginLevel({ mode: "both", ear: "right", levels, idx: 0 });
  }

  function testEar(e: Ear) {
    clearEar(e);
    void beginLevel({ mode: "single", ear: e, levels, idx: 0 });
  }

  async function stopTest() {
    jobRef.current = null;
    setJob(null);
    await act("stop", api.stimStop, () => { stim.refetch(); });
  }

  /** Simpan level aktif ke panel telinganya, lalu hentikan stimulus dan reset rata-rata. */
  const savingRef = useRef(false);
  async function save(): Promise<EarResult | null> {
    if (savingRef.current) return null;
    savingRef.current = true;
    const savedEar = ear;
    const snapshot = abrResult;
    const r = await act("save", () => api.saveSession({ ear: savedEar, device: deviceName ?? undefined, stim_db: db }));
    savingRef.current = false;
    if (!r?.file) return null;

    const result = toEarResult(snapshot, r.file, db);
    addEarResult(savedEar, result);
    await api.stimStop().catch(() => {});
    await api.reset().catch(() => {});
    clearLocal();
    stim.refetch();
    return result;
  }

  /** Simpan manual dari bagian Technical details. */
  async function saveNow() {
    const savedEar = ear;
    if (!(await save())) return;
    jobRef.current = null;
    setJob(null);
    setMessage({ kind: "success", text: `${EAR_NAME[savedEar]} at ${db} dB saved.` });
  }

  function newPatient() {
    clearEarSlots();
    setEar("right");
    setMessage(null);
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

  // Target trial tercapai → simpan level ini, lalu lanjut ke level / telinga berikutnya.
  // Di luar tes berjalan hanya otomatis kalau Settings → Auto-save aktif.
  const autoSavedRef = useRef(false);
  useEffect(() => {
    if (trials < target) autoSavedRef.current = false;
    const auto = settings.autoSave || testing;
    if (!auto || !isLive || autoSavedRef.current || trials < target) return;
    if (nowMs() - earStartRef.current < SETTLE_MS) return;
    autoSavedRef.current = true;
    void (async () => {
      const result = await save();
      const j = jobRef.current;
      if (!result || !j) return;
      // Tidak ada respons di level ini → level lebih rendah juga tidak akan ada (ambang sudah lewat).
      const responded = result.outcome === "Pass";
      if (j.idx + 1 < j.levels.length && (responded || !settings.stopAtThreshold)) {
        await beginLevel({ ...j, idx: j.idx + 1 });
      } else if (j.mode === "both" && j.ear === "right") {
        await beginLevel({ ...j, ear: "left", idx: 0 });
      } else {
        jobRef.current = null;
        setJob(null);
        setMessage({ kind: "success", text: j.mode === "both" ? "Both ears are done." : `${EAR_NAME[j.ear]} done.` });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trials, target, settings.autoSave, isLive, testing]);

  const badge = paused
    ? <Badge>Paused</Badge>
    : status === "live"
      ? <Badge tone={stimRunning ? "live" : "success"} pulse={stimRunning}>{stimRunning ? "Recording" : "Ready"}</Badge>
      : status === "simulation"
        ? <Badge tone="warning">Simulation</Badge>
        : status === "connecting"
          ? <Badge>Connecting…</Badge>
          : <Badge tone="error">Offline</Badge>;

  const intro = job
    ? `Testing the ${EAR_NAME[job.ear].toLowerCase()} at ${job.levels[job.idx]} dB.`
    : bothDone
      ? "Both ears are done."
      : nextEar
        ? `Continue with the ${EAR_NAME[nextEar].toLowerCase()}.`
        : `Tests both ears at ${levels.join(", ")} dB.`;

  return (
    <>
      <TopBar
        title="Start Scan"
        actions={
          <div className="flex items-center gap-3 min-w-0">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-on-surface-variant truncate">
              <StatusDot ok={simulation ? null : !!deviceName} />
              <span className="font-mono truncate">{simulation ? "simulated device" : deviceName ?? "no device"}</span>
              {!simulation && battery != null && (
                <span className={`tabular-nums ${battery <= 15 ? "text-error font-semibold" : ""}`} title="Headset battery">{battery}%</span>
              )}
            </span>
            {badge}
          </div>
        }
      />

      <Page>
        {/* ── Header + main action ───────────────────────────── */}
        <section className="pt-2">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight text-on-surface">Hearing test</h2>
              <p className="text-sm text-on-surface-variant mt-1">{intro}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {testing ? (
                <Button variant="danger" onClick={stopTest} disabled={busy === "stop"}><MdStop />Stop test</Button>
              ) : bothDone ? (
                <Button variant="outline" onClick={newPatient}><MdPersonAdd />New patient</Button>
              ) : nextEar ? (
                <>
                  <Button variant="ghost" onClick={newPatient}>Start over</Button>
                  <Button variant="secondary" onClick={() => testEar(nextEar)} disabled={!isLive || busy === "start"}>
                    <MdPlayArrow />Continue with {EAR_NAME[nextEar].toLowerCase()}
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={startTest} disabled={!isLive || busy === "start"}><MdPlayArrow />Start test</Button>
              )}
            </div>
          </div>

        </section>

        {status === "offline" && (
          <div className="space-y-2">
            <OfflineBanner message={`Backend ${backendUrl()} is unreachable. Retrying every 5 s.`} />
            <Button variant="ghost" size="sm" onClick={() => setSimulation(true)} className="-ml-3"><MdScience />Run a simulation instead</Button>
          </div>
        )}
        {simulation && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-tertiary-fixed px-4 py-3 text-sm text-on-tertiary-fixed-variant">
            <p><strong className="font-semibold">Simulation mode.</strong> The waveform is generated, not measured, and cannot be saved.</p>
            <Button variant="outline" size="sm" onClick={() => setSimulation(false)} className="shrink-0">Back to live</Button>
          </div>
        )}
        {routeWarn && testing && (
          <Notice kind="info">
            The device did not confirm the ear switch. Check that the sound plays in the {EAR_NAME[ear].toLowerCase()}.
          </Notice>
        )}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}

        {/* ── Two ears, in test order ────────────────────────── */}
        <section aria-label="Ears" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {EARS.map((e, i) => (
            <EarPanel
              key={e}
              ear={e}
              step={i + 1}
              job={job?.ear === e ? job : null}
              recording={job?.ear === e && stimRunning}
              results={slots[e]}
              live={abrResult}
              ghost={showGhost ? prevResult?.abr_average?.[0] ?? null : null}
              target={target}
              canRetest={isLive && !testing && !stimRunning}
              onRetest={() => testEar(e)}
              waitingText={
                testing && job?.mode === "both" ? "Starts automatically after the right ear."
                  : nextEar === e ? "Press Continue to test this ear."
                    : e === "right" ? "Starts when you press Start test." : "Starts automatically after the right ear."
              }
            />
          ))}
        </section>

        {done("left") && done("right") && <InterauralCard slots={slots} />}

        {/* ── Technical details (disembunyikan) ─────────────── */}
        <details className="group bg-surface-container-lowest border border-outline-variant/60 rounded-2xl">
          <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-semibold text-on-surface">Technical details</span>
              <span className="text-on-surface-variant"> for researchers: raw signal, SNR, latencies and manual controls</span>
            </span>
            <span className="text-on-surface-variant transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true">▾</span>
          </summary>

          <div className="px-5 pb-5 space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center h-8 rounded-lg border border-outline-variant bg-surface-container-lowest" role="group" aria-label="Manual stimulus level">
                <button type="button" onClick={() => changeDb(db - DB_STEP)} disabled={!isLive || testing || db <= DB_MIN || busy === "db"} className="h-full px-2 text-on-surface-variant hover:text-on-surface disabled:opacity-40" aria-label="Lower level">
                  <MdRemove />
                </button>
                <span className="w-14 text-center text-xs font-semibold font-mono tabular-nums text-on-surface">{db} dB</span>
                <button type="button" onClick={() => changeDb(db + DB_STEP)} disabled={!isLive || testing || db >= DB_MAX || busy === "db"} className="h-full px-2 text-on-surface-variant hover:text-on-surface disabled:opacity-40" aria-label="Raise level">
                  <MdAdd />
                </button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPaused(!paused)} title="Freeze the display; recording keeps running">
                {paused ? <MdPlayArrow /> : <MdPause />}{paused ? "Resume view" : "Pause view"}
              </Button>
              <Button variant="outline" size="sm" onClick={resetAverage} disabled={busy === "reset" || (!isLive && !simulation)}>
                <MdRefresh />Reset average
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={saveNow}
                disabled={!canSave}
                title={simulation ? "Simulated data cannot be saved" : trials < MIN_TRIALS ? `Needs at least ${MIN_TRIALS} trials` : undefined}
              >
                <MdSave />{busy === "save" ? "Saving…" : `Save ${EAR_NAME[ear].toLowerCase()} now`}
              </Button>
              <span className="text-xs text-on-surface-variant font-mono tabular-nums sm:ml-auto">
                {lastPacketAt ? `last packet ${formatAgo(new Date(lastPacketAt).toISOString(), now)}` : "no packets yet"}
              </span>
            </div>

            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-8 space-y-4 min-w-0">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-on-surface-variant">
                  <Segmented
                    label="Chart" size="sm" value={tab} onChange={setTab}
                    options={[{ value: "abr", label: "ABR average" }, { value: "raw", label: "Raw EEG" }]}
                  />
                  {tab === "abr" && (
                    <>
                      <Segmented
                        label="Time range" size="sm" value={range} onChange={setRange}
                        options={[{ value: "abr", label: "0–10 ms" }, { value: "full", label: "Full epoch" }]}
                      />
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" className="accent-primary" checked={showCh2} onChange={e => setShowCh2(e.target.checked)} />
                        <span className="inline-block w-5 h-0.5 rounded bg-primary-container" />Ch 2
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" className="accent-primary" checked={showGhost} onChange={e => setShowGhost(e.target.checked)} />
                        <span className="inline-block w-5 h-0.5 rounded bg-outline opacity-60" />Previous snapshot
                      </label>
                    </>
                  )}
                </div>
                {tab === "abr" ? (
                  <ABRWaveformChart
                    data={abrResult}
                    channels={showCh2 ? [0, 1] : [0]}
                    ghost={showGhost ? prevResult?.abr_average?.[0] ?? null : null}
                    range={range === "abr" ? [0, 10] : [-(abrResult.pre_stim_ms ?? 10), abrResult.epoch_ms - (abrResult.pre_stim_ms ?? 10)]}
                    height={260}
                  />
                ) : (
                  <>
                    <p className="text-xs text-on-surface-variant">
                      Last {Math.round((raw.ch1.length / raw.fs) * 1000)} ms at {raw.fs / 1000} kHz, centred on the mean. Dashed lines are stimulus markers.
                    </p>
                    <RawWaveformChart raw={raw} height={260} />
                  </>
                )}
              </div>

              <dl className="col-span-12 lg:col-span-4 grid grid-cols-2 gap-2 content-start">
                <Stat label="Trials" value={trials.toLocaleString()} />
                <Stat label="Status" value={statusLabel(abrResult.status ?? abrResult.quality)} />
                <Stat label="SNR Ch 1" value={`${(snr[0] ?? 0).toFixed(1)} dB`} tone={(snr[0] ?? 0) >= SNR_GOOD_DB ? "good" : undefined} />
                <Stat label="SNR Ch 2" value={`${(snr[1] ?? 0).toFixed(1)} dB`} tone={(snr[1] ?? 0) >= SNR_GOOD_DB ? "good" : undefined} />
                <Stat label="Pearson r" value={(abrResult.pearson_r ?? 0).toFixed(3)} />
                <Stat label="Stimuli / frames" value={`${(abrResult.stim_count ?? 0).toLocaleString()} / ${(abrResult.frame_count ?? 0).toLocaleString()}`} />
                {(["I", "III", "V"] as const).map(name => {
                  const w = waves.find(x => x.name === name);
                  return <Stat key={name} label={`Wave ${name}`} value={w ? `${w.latency_ms.toFixed(2)} ms` : "—"} />;
                })}
                <Stat label="I–V interval" value={ivInt != null ? `${ivInt.toFixed(2)} ms` : "—"} />
              </dl>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-on-surface">Packet log <span className="font-normal text-on-surface-variant">raw stream packets, every 200 ms</span></p>
              <FrameLog packets={packets} />
            </div>
          </div>
        </details>
      </Page>
    </>
  );
}

/**
 * Satu telinga: gelombang tiap level ditumpuk dari yang paling keras (gaya
 * intensity series ABR), level yang sedang dites tampil live di atasnya.
 */
/** Wave V kiri vs kanan di level yang sama. Selisih > 0.4 ms → curiga gangguan di satu sisi. */
function InterauralCard({ slots }: { slots: EarSlots }) {
  const rows = interauralV(slots);
  const asym = rows.filter(r => !r.normal);
  return (
    <Card
      title="Left vs right (wave V)"
      description={`Same device and dB level on both ears, so no calibration is needed. A difference above ${INTERAURAL_V_MAX_MS} ms suggests a problem on one side.`}
      action={rows.length > 0 && (
        <span className={`text-sm font-semibold ${asym.length ? "text-error" : "text-secondary"}`}>
          {asym.length ? "Asymmetric" : "Symmetric"}
        </span>
      )}
      flush
    >
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-on-surface-variant">No level has wave V (Pass) in both ears yet, so the ears cannot be compared.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="border-y border-outline-variant/50 text-xs text-on-surface-variant text-left">
            <th className="px-5 py-2.5 font-medium">Level</th><th className="px-5 py-2.5 font-medium text-right">Left V (ms)</th><th className="px-5 py-2.5 font-medium text-right">Right V (ms)</th><th className="px-5 py-2.5 font-medium text-right">Difference</th>
          </tr></thead>
          <tbody className="divide-y divide-outline-variant/50 font-mono tabular-nums">
            {rows.map(r => (
              <tr key={r.stim_db}>
                <td className="px-5 py-2.5 font-sans">{r.stim_db} dB</td>
                <td className="px-5 py-2.5 text-right">{r.left.toFixed(2)}</td>
                <td className="px-5 py-2.5 text-right">{r.right.toFixed(2)}</td>
                <td className={`px-5 py-2.5 text-right font-semibold ${r.normal ? "text-secondary" : "text-error"}`}>
                  {Math.abs(r.diff).toFixed(2)} ms{!r.normal && <span className="font-sans font-normal"> · {r.diff > 0 ? "left" : "right"} slower</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function EarPanel({ ear, step, job, recording, results, live, ghost, target, canRetest, onRetest, waitingText }: {
  ear: Ear;
  step: number;
  job: Job | null;
  recording: boolean;
  results: EarResult[];
  live: ABRResult;
  ghost: number[] | null;
  target: number;
  canRetest: boolean;
  onRetest: () => void;
  waitingText: string;
}) {
  const active = job !== null;
  const level = job ? job.levels[job.idx] : null;
  const trials = live.trial_count;
  const signalGood = (live.snr?.[0] ?? 0) >= SNR_GOOD_DB;
  const threshold = thresholdOf(results);

  return (
    <Card
      className={active ? "border-primary/50! ring-2 ring-primary/15" : ""}
      title={
        <div className="flex items-center gap-2.5">
          <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
            active ? "bg-primary text-on-primary" : results.length ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"
          }`} aria-hidden="true">
            {step}
          </span>
          <h3 className="text-[15px] font-semibold text-on-surface">{EAR_NAME[ear]}</h3>
        </div>
      }
      action={
        active ? <Badge tone={recording ? "live" : "neutral"} pulse={recording}>{recording ? `Testing ${level} dB` : `${level} dB`}</Badge>
          : results.length ? (threshold != null ? <Badge tone="success">Threshold {threshold} dB</Badge> : <Badge tone="error">No response</Badge>)
            : <Badge>Waiting</Badge>
      }
    >
      <div className="space-y-4">
        {active && job && (
          <div className="space-y-3">
            <ABRWaveformChart data={live} ghost={ghost} range={[0, 10]} height={180} compact />
            <div>
              <div className="flex items-baseline justify-between text-sm mb-1.5">
                <span className="text-on-surface-variant">Level {job.idx + 1} of {job.levels.length}, responses collected</span>
                <span className="font-semibold tabular-nums text-on-surface">{trials.toLocaleString()} <span className="font-normal text-on-surface-variant">of {target.toLocaleString()}</span></span>
              </div>
              <div className="h-2 rounded-full bg-surface-container-high overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={trials} aria-label={`${EAR_NAME[ear]} at ${level} dB`}>
                <div className="h-full rounded-full bg-secondary transition-[width] motion-reduce:transition-none" style={{ width: `${Math.min(100, (trials / target) * 100)}%` }} />
              </div>
            </div>
            <p className="flex items-center gap-2 text-sm text-on-surface-variant">
              <StatusDot ok={trials < MIN_TRIALS ? null : signalGood} />
              {trials < MIN_TRIALS ? "Signal quality shows after the first 100 responses." : signalGood ? "Signal quality is good." : "Signal is weak. Ask the patient to relax and stay still."}
            </p>
          </div>
        )}

        {results.length > 0 && (
          <ul className="divide-y divide-outline-variant/50 rounded-xl bg-surface-container-low">
            {results.map(r => (
              <li key={r.stim_db} className="flex items-center gap-3 px-3 py-2">
                <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-on-surface">{r.stim_db} dB</span>
                <div className="flex-1 min-w-0">
                  <ABRWaveformChart data={r.chart} range={[0, 10]} height={72} compact />
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <OutcomeChip outcome={r.outcome} />
                  <Link href={`/results?file=${encodeURIComponent(r.file)}`} className="text-xs font-medium text-primary hover:underline">View</Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!active && results.length === 0 && (
          <div className="h-[180px] rounded-xl border border-dashed border-outline-variant flex items-center justify-center text-center px-6 text-sm text-on-surface-variant">
            {waitingText}
          </div>
        )}

        {!active && results.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-on-surface-variant">
              {threshold != null
                ? <>Responds down to <span className="font-semibold text-on-surface">{threshold} dB</span>.</>
                : "No clear response at the tested levels."}
            </p>
            <Button variant="ghost" size="sm" onClick={onRetest} disabled={!canRetest}>Retest</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
