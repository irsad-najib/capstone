"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopBar from "@/components/TopBar";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import { Button, ButtonLink, Card, Footer, OutcomeChip, Page, Row, Segmented, Stat } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, type SessionDetail, type Snapshot } from "@/lib/api";
import {
  INTERPEAK_NORMS, OUTCOME_INFO, SNR_GOOD_DB, detectWaves, downloadJSON, normRange, normalOf, outcomeOf, preStimMs, validWaves,
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
  const normal = normalOf(analysis);

  return (
    <>
      <TopBar
        title="Result"
        actions={
          <ButtonLink href="/records" variant="ghost" size="sm" className="hidden sm:inline-flex print:hidden">
            <MdArrowBack />History
          </ButtonLink>
        }
      />

      <Page>
        {loading && (
          <div className="py-20 text-center text-sm text-on-surface-variant">
            <MdAutorenew className="mx-auto mb-3 text-4xl animate-spin motion-reduce:animate-none" />Loading result…
          </div>
        )}

        {!loading && (error || !doc) && (
          <div className="py-20 text-center text-on-surface-variant space-y-2">
            <MdCloudOff className="mx-auto text-4xl text-error" />
            <p className="text-sm font-medium text-on-surface">Could not load this session.</p>
            {error && <p className="text-xs font-mono">{error}</p>}
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
              <ButtonLink href="/records" variant="primary" size="sm">Back to history</ButtonLink>
            </div>
          </div>
        )}

        {doc && outcome && chartData && (
          <>
            {/* ── Verdict hero ───────────────────────────────────── */}
            <section className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-6 md:p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="space-y-3 min-w-0">
                <p className="text-sm text-on-surface-variant">
                  Screening result{doc.ear ? `, ${doc.ear === "left" ? "left" : "right"} ear` : ""}
                </p>
                <h2 className={`flex items-center gap-3 text-5xl md:text-6xl font-semibold tracking-tight ${OUTCOME_INFO[outcome].text}`}>
                  <span aria-hidden="true" className="text-4xl md:text-5xl">{OUTCOME_INFO[outcome].icon}</span>{OUTCOME_INFO[outcome].label}
                </h2>
                <p className="text-base text-on-surface-variant max-w-2xl">{OUTCOME_INFO[outcome].description}</p>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-sm">
                  <div className="flex gap-1.5"><dt className="text-on-surface-variant">Date</dt><dd className="text-on-surface">{doc.saved_at ? new Date(doc.saved_at).toLocaleString() : "—"}</dd></div>
                  <div className="flex gap-1.5"><dt className="text-on-surface-variant">Responses</dt><dd className="text-on-surface tabular-nums">{doc.trial_count.toLocaleString()}</dd></div>
                  {doc.stim_db ? <div className="flex gap-1.5"><dt className="text-on-surface-variant">Level</dt><dd className="text-on-surface tabular-nums">{doc.stim_db} dB</dd></div> : null}
                </dl>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button variant="primary" onClick={() => window.print()}><MdPictureAsPdf />Export PDF</Button>
                <Button variant="outline" onClick={() => downloadJSON(filename, doc)}><MdDownload />JSON</Button>
                <ButtonLink href="/scan" variant="outline"><MdReplay />Re-run scan</ButtonLink>
              </div>
            </section>

            <Segmented
              label="Result view"
              className="print:hidden"
              value={tab}
              onChange={setTab}
              options={[{ value: "visual", label: "Visual" }, { value: "metrics", label: "Metrics" }]}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-6 min-w-0">
                {/* Visual — tetap tercetak di PDF */}
                <div className={tab === "visual" ? "" : "hidden print:block"}>
                  <Card
                    title="Final ABR waveform"
                    className="break-inside-avoid"
                    action={
                      <div className="hidden sm:flex gap-4 text-xs text-on-surface-variant">
                        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 rounded bg-secondary" />Ch 1</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 rounded bg-primary-container" />Ch 2</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-3 rounded-sm bg-secondary-container" />Wave V window</span>
                      </div>
                    }
                  >
                    <ABRWaveformChart data={chartData} channels={[0, 1]} range={[0, 10]} height={300} />
                    <h3 className="pt-6 pb-3 text-sm font-semibold text-on-surface">Convergence</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {pickSnapshots(doc).map((s, i, arr) => (
                        <figure key={s.trial_count} className="rounded-xl bg-surface-container-low p-2">
                          <ABRWaveformChart
                            data={{ ...chartData, abr_average: s.abr_average, trial_count: s.trial_count, analysis: i === arr.length - 1 ? analysis : undefined }}
                            range={[0, 10]} height={110} compact
                          />
                          <figcaption className="mt-1 px-1 text-xs text-on-surface-variant">
                            <span className="font-mono tabular-nums text-on-surface">{s.trial_count}</span> trials{i === arr.length - 1 ? ", final" : ""}
                            {s.pearson_r ? <span className="block font-mono tabular-nums">r = {s.pearson_r.toFixed(2)}</span> : null}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* Metrics */}
                <div className={`${tab === "metrics" ? "" : "hidden print:block"} space-y-6`}>
                  <Card title="Waves (Ch 1)" flush className="break-inside-avoid">
                    {waves.length === 0 ? (
                      <p className="px-5 pb-5 text-sm text-on-surface-variant">No wave peaks detected.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead><tr className="border-y border-outline-variant/50 text-xs text-on-surface-variant text-left">
                          <th className="px-5 py-2.5 font-medium">Wave</th><th className="px-5 py-2.5 font-medium text-right">Latency (ms)</th><th className="px-5 py-2.5 font-medium text-right">Amplitude (µV)</th>
                        </tr></thead>
                        <tbody className="divide-y divide-outline-variant/50 font-mono tabular-nums">
                          {waves.map(w => (
                            <tr key={w.name}><td className="px-5 py-2.5 font-sans font-semibold">{w.name}</td><td className="px-5 py-2.5 text-right">{w.latency_ms.toFixed(3)}</td><td className="px-5 py-2.5 text-right">{w.amplitude_uv.toFixed(3)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Card>

                  <Card title="Interpeak intervals" description="Normal adult range (mean ± 2 SD, click 85 dB nHL) shown under each value." className="break-inside-avoid">
                    <dl className="grid grid-cols-3 gap-2">
                      {Object.keys(INTERPEAK_NORMS).map(k => {
                        const v = waves.length ? analysis?.interpeak_ms?.[k] : undefined;
                        const [lo, hi] = normRange(k);
                        return (
                          <div key={k} className="space-y-1">
                            <Stat label={k.replace("-", "–")} value={v != null ? `${v.toFixed(2)} ms` : "—"} tone={v == null ? undefined : v >= lo && v <= hi ? "good" : "bad"} />
                            <p className="px-1 text-xs text-on-surface-variant font-mono">{lo.toFixed(2)}–{hi.toFixed(2)} ms</p>
                          </div>
                        );
                      })}
                    </dl>
                  </Card>

                  <Card title="Signal and acquisition" className="break-inside-avoid">
                    <dl className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {(doc.snr ?? []).map((v, ch) => (
                        <Stat key={ch} label={`SNR Ch ${ch + 1}`} value={`${v.toFixed(2)} dB`} tone={v >= SNR_GOOD_DB ? "good" : "bad"} />
                      ))}
                      <Stat label="Pearson r (stability)" value={(doc.pearson_r ?? 0).toFixed(3)} tone={(doc.pearson_r ?? 0) >= 0.9 ? "good" : "bad"} />
                      <Stat label="Sampling rate" value={`${fs.toLocaleString()} Hz`} />
                      <Stat label="Epoch length" value={`${doc.epoch_ms} ms (${pre} pre)`} />
                      <Stat label="Samples / channel" value={`${doc.abr_average?.[0]?.length ?? 0}`} />
                    </dl>
                  </Card>
                </div>
              </div>

              <aside className="lg:col-span-4 space-y-4">
                <Card title="Session">
                  <dl className="divide-y divide-outline-variant/50 -my-2.5">
                    <Row label="File" value={<span className="text-xs break-all">{filename}</span>} />
                    <Row label="Saved at" mono={false} value={doc.saved_at ? new Date(doc.saved_at).toLocaleString() : "—"} />
                    <Row label="Device" value={<span className="text-xs">{doc.device || "—"}</span>} />
                    <Row label="Ear" mono={false} value={doc.ear ? (doc.ear === "left" ? "Left" : "Right") : "—"} />
                    <Row label="Stimulus" mono={false} value={doc.stim_db ? `Tone burst, ${doc.stim_db} dB` : "—"} />
                    <Row label="Result" mono={false} value={<OutcomeChip outcome={outcome} />} />
                    <Row label="Normal" mono={false} value={<span className={normal.normal ? "text-secondary font-semibold" : "text-error font-semibold"}>{normal.normal ? "Yes" : "No"}</span>} />
                    {doc.note && <Row label="Note" mono={false} value={doc.note} />}
                  </dl>
                </Card>
                <section className="rounded-2xl bg-surface-container-low p-5 text-sm text-on-surface-variant space-y-1.5">
                  <p className="font-semibold text-on-surface">How the result is decided</p>
                  <p>Pass requires status <em>Konvergen</em> (≥500 trials and r ≥ 0.9 between successive running averages), SNR ≥ {SNR_GOOD_DB} dB on Ch 1, and Wave I, III and V detected.</p>
                  <p>Normal = Pass and every interpeak interval within the adult range above.{normal.reasons.length > 0 && <> Not normal because: {normal.reasons.join("; ")}.</>}</p>
                </section>
              </aside>
            </div>
          </>
        )}

        <Footer />
      </Page>
    </>
  );
}
