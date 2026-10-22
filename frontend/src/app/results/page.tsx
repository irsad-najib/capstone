"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import { Footer, OutcomeChip } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, type SessionDetail, type Snapshot } from "@/lib/api";
import {
  OUTCOME_INFO, SNR_GOOD_DB, detectWaves, downloadJSON, outcomeOf, preStimMs, statusLabel, validWaves,
} from "@/lib/abr";
import { MdArrowBack, MdAutorenew, MdCloudOff, MdDownload, MdPictureAsPdf, MdReplay } from "react-icons/md";

type Tab = "visual" | "metrics";

export default function ResultsPage() {
  return (
    <Suspense fallback={<p className="pt-24 text-center text-sm text-on-surface-variant">Loading…</p>}>
      <ResultsContent />
    </Suspense>
  );
}

/** Snapshot terdekat ke 100 / 250 / 500 trial (backend menyimpan tiap 100), plus hasil akhir. */
function pickSnapshots(doc: SessionDetail): Snapshot[] {
  const snaps = (doc.abr_snapshots ?? []).filter(s => s.trial_count < doc.trial_count);
  const picked: Snapshot[] = [];
  for (const want of [100, 250, 500]) {
    let best: Snapshot | null = null;
    for (const s of snaps) if (!best || Math.abs(s.trial_count - want) < Math.abs(best.trial_count - want)) best = s;
    if (best && !picked.includes(best)) picked.push(best);
  }
  picked.sort((a, b) => a.trial_count - b.trial_count);
  return [...picked, { trial_count: doc.trial_count, abr_average: doc.abr_average, pearson_r: doc.pearson_r }];
}

function ResultsContent() {
  const router = useRouter();
  const filename = useSearchParams().get("file");

  useEffect(() => {
    if (!filename) router.replace("/records");
  }, [filename, router]);

  const fetcher = useCallback(() => (filename ? api.session(filename) : Promise.resolve(null)), [filename]);
  const { data: doc, loading, error, refetch } = useBackend<SessionDetail | null>(fetcher, 0);
  const [tab, setTab] = useState<Tab>("visual");

  if (!filename) return null;

  const fs = doc?.sampling_rate || 16000;
  const pre = doc ? preStimMs(doc) : 10;
  const status = doc?.status ?? doc?.quality;
  // Sesi lama tanpa `analysis`: hitung ulang dengan aturan yang sama dengan backend
  const analysis = doc ? (doc.analysis?.waves ? doc.analysis : { ...detectWaves(doc.abr_average?.[0] ?? [], fs, pre), verdict: doc.analysis?.verdict }) : undefined;
  const waves = validWaves(analysis?.waves);
  const outcome = doc ? outcomeOf({ trial_count: doc.trial_count, status, verdict: analysis?.verdict }) : null;
  const chartData = doc ? { ...doc, pre_stim_ms: pre, analysis } : null;

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div className="min-w-0">
              <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Saved session</p>
              <p className="text-[11px] font-mono text-on-surface-variant truncate">{filename}</p>
            </div>
          </>
        }
        right={
          <Link href="/records" className="hidden sm:flex items-center gap-1 text-xs font-bold text-primary hover:underline print:hidden">
            <MdArrowBack />History
          </Link>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-6">
        {loading && (
          <div className="py-20 text-center text-on-surface-variant">
            <MdAutorenew className="mx-auto mb-3 text-[40px] animate-spin motion-reduce:animate-none" />Loading result…
          </div>
        )}

        {!loading && (error || !doc) && (
          <div className="py-20 text-center text-on-surface-variant space-y-2">
            <MdCloudOff className="mx-auto text-[40px] text-error" />
            <p className="text-sm">Could not load this session.</p>
            {error && <p className="text-xs font-mono">{error}</p>}
            <div className="flex justify-center gap-2 pt-2">
              <button onClick={refetch} className="px-4 py-2 rounded-lg border border-outline-variant text-xs font-bold text-primary">Retry</button>
              <Link href="/records" className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-bold">Back to history</Link>
            </div>
          </div>
        )}

        {doc && outcome && chartData && (
          <>
            {/* ── Verdict hero ───────────────────────────────────── */}
            <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 md:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-3">
                <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Screening result</p>
                <h1 className={`text-5xl md:text-6xl font-extrabold tracking-tight ${OUTCOME_INFO[outcome].text}`}>
                  <span aria-hidden="true">{OUTCOME_INFO[outcome].icon} </span>{OUTCOME_INFO[outcome].label.toUpperCase()}
                </h1>
                <p className="text-base text-on-surface-variant max-w-2xl">{OUTCOME_INFO[outcome].description}</p>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-on-surface-variant">
                  <div><dt className="inline">Ear: </dt><dd className="inline font-bold text-on-surface">{doc.ear ? (doc.ear === "left" ? "Left" : "Right") : "—"}</dd></div>
                  <div><dt className="inline">Date: </dt><dd className="inline font-bold text-on-surface">{doc.saved_at ? new Date(doc.saved_at).toLocaleString() : "—"}</dd></div>
                  <div><dt className="inline">Trials: </dt><dd className="inline font-bold text-on-surface font-mono">{doc.trial_count.toLocaleString()}</dd></div>
                  <div><dt className="inline">Status: </dt><dd className="inline font-bold text-on-surface">{statusLabel(status)}</dd></div>
                </dl>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button onClick={() => window.print()} className="min-h-10 flex items-center gap-2 px-4 bg-primary text-on-primary rounded-lg text-xs font-bold hover:opacity-90">
                  <MdPictureAsPdf className="text-lg" />Export PDF
                </button>
                <button onClick={() => downloadJSON(filename, doc)} className="min-h-10 flex items-center gap-2 px-4 border border-outline-variant rounded-lg text-xs font-bold text-primary hover:bg-surface-container-low">
                  <MdDownload className="text-lg" />JSON
                </button>
                <Link href="/scan" className="min-h-10 flex items-center gap-2 px-4 border border-outline-variant rounded-lg text-xs font-bold text-primary hover:bg-surface-container-low">
                  <MdReplay className="text-lg" />Re-run scan
                </Link>
              </div>
            </section>

            {/* ── Tabs ───────────────────────────────────────────── */}
            <div className="flex gap-6 border-b border-outline-variant print:hidden" role="tablist">
              {(["visual", "metrics"] as Tab[]).map(t => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`pb-3 px-1 text-xs font-bold border-b-4 -mb-px ${tab === t ? "text-primary border-primary" : "text-on-surface-variant border-transparent hover:text-primary"}`}>
                  {t === "visual" ? "Visual" : "Metrics"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-6 min-w-0">
                {/* Visual — tetap tercetak di PDF */}
                <section className={`${tab === "visual" ? "" : "hidden print:block"} bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 space-y-3 break-inside-avoid`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-bold text-primary">Final ABR waveform</h2>
                    <div className="flex gap-4 text-[11px] text-on-surface-variant">
                      <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-secondary" />Ch 1</span>
                      <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-primary-container" />Ch 2</span>
                      <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-3 rounded-sm bg-secondary-container" />Wave V window</span>
                    </div>
                  </div>
                  <ABRWaveformChart data={chartData} channels={[0, 1]} range={[0, 10]} height={300} />
                  <h3 className="pt-2 text-sm font-bold text-primary">Convergence</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {pickSnapshots(doc).map((s, i, arr) => (
                      <figure key={s.trial_count} className="rounded-lg border border-outline-variant/60 p-2">
                        <ABRWaveformChart
                          data={{ ...chartData, abr_average: s.abr_average, trial_count: s.trial_count, analysis: i === arr.length - 1 ? analysis : undefined }}
                          range={[0, 10]} height={110} compact
                        />
                        <figcaption className="mt-1 text-[11px] text-on-surface-variant font-mono">
                          {i === arr.length - 1 ? "Final · " : ""}{s.trial_count} trials
                          {s.pearson_r ? <span className="block">r = {s.pearson_r.toFixed(2)}</span> : null}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>

                {/* Metrics */}
                <section className={`${tab === "metrics" ? "" : "hidden print:block"} bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden break-inside-avoid`}>
                  <h2 className="px-5 py-4 text-base font-bold text-primary border-b border-outline-variant">Waves (Ch 1)</h2>
                  {waves.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-on-surface-variant">No wave peaks detected.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="bg-surface-container-low text-xs text-on-surface-variant text-left">
                        <th className="px-5 py-2">Wave</th><th className="px-5 py-2 text-right">Latency (ms)</th><th className="px-5 py-2 text-right">Amplitude (µV)</th>
                      </tr></thead>
                      <tbody className="divide-y divide-outline-variant/60 font-mono tabular-nums">
                        {waves.map(w => (
                          <tr key={w.name}><td className="px-5 py-2 font-sans font-bold">{w.name}</td><td className="px-5 py-2 text-right">{w.latency_ms.toFixed(3)}</td><td className="px-5 py-2 text-right">{w.amplitude_uv.toFixed(3)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <h2 className="px-5 py-4 text-base font-bold text-primary border-y border-outline-variant">Interpeak intervals</h2>
                  <dl className="grid grid-cols-3 text-center py-4">
                    {["I-III", "III-V", "I-V"].map(k => (
                      <div key={k}>
                        <dt className="text-xs text-on-surface-variant">{k.replace("-", "–")}</dt>
                        <dd className="font-mono tabular-nums text-lg font-bold">{waves.length && analysis?.interpeak_ms?.[k] != null ? analysis.interpeak_ms[k].toFixed(2) : "—"}<span className="text-xs font-normal"> ms</span></dd>
                      </div>
                    ))}
                  </dl>
                  <h2 className="px-5 py-4 text-base font-bold text-primary border-y border-outline-variant">Signal &amp; acquisition</h2>
                  <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 p-5 text-sm">
                    {(doc.snr ?? []).map((v, ch) => (
                      <Metric key={ch} label={`SNR Ch ${ch + 1}`} value={`${v.toFixed(2)} dB`} good={v >= SNR_GOOD_DB} />
                    ))}
                    <Metric label="Pearson r (stability)" value={(doc.pearson_r ?? 0).toFixed(3)} good={(doc.pearson_r ?? 0) >= 0.9} />
                    <Metric label="Sampling rate" value={`${fs.toLocaleString()} Hz`} />
                    <Metric label="Epoch length" value={`${doc.epoch_ms} ms (${pre} ms pre-stim)`} />
                    <Metric label="Samples / channel" value={`${doc.abr_average?.[0]?.length ?? 0}`} />
                  </dl>
                </section>
              </div>

              <aside className="lg:col-span-4 space-y-4">
                <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 space-y-3">
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Session info</h2>
                  <dl className="space-y-2 text-sm">
                    <Row label="File" value={<span className="font-mono text-xs break-all">{filename}</span>} />
                    <Row label="Saved at" value={doc.saved_at ? new Date(doc.saved_at).toLocaleString() : "—"} />
                    <Row label="Device" value={<span className="font-mono text-xs">{doc.device || "—"}</span>} />
                    <Row label="Ear" value={doc.ear ? (doc.ear === "left" ? "Left" : "Right") : "—"} />
                    <Row label="Stimulus" value={doc.stim_db ? `Tone burst · ${doc.stim_db} dB` : "—"} />
                    <Row label="Result" value={<OutcomeChip outcome={outcome} />} />
                    {doc.note && <Row label="Note" value={doc.note} />}
                  </dl>
                </section>
                <section className="bg-surface-container-low border border-outline-variant rounded-2xl p-5 text-xs text-on-surface-variant space-y-1">
                  <p className="font-bold text-on-surface">How the result is decided</p>
                  <p>Pass requires status <em>Konvergen</em> (≥500 trials and r ≥ 0.9 between successive running averages), SNR ≥ {SNR_GOOD_DB} dB on Ch 1, and Wave I, III and V detected.</p>
                </section>
              </aside>
            </div>
          </>
        )}

        <Footer />
      </main>
    </>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className={`font-mono tabular-nums font-bold ${good === undefined ? "" : good ? "text-secondary" : "text-error"}`}>
        {value}{good !== undefined && <span className="sr-only">{good ? " (good)" : " (weak)"}</span>}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-on-surface-variant shrink-0">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
