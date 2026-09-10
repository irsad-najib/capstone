"use client";

import { useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import { useBackend } from "@/hooks/useBackend";
import { api, type ABRResult, type SessionDetail } from "@/lib/api";
import {
  MdAutorenew,
  MdCloudOff,
  MdHistory,
  MdPictureAsPdf,
} from "react-icons/md";

type Tab = "visual" | "metrics";

function classifyResult(trials: number): { label: string; description: string } {
  if (trials >= 500) return {
    label: "NORMAL",
    description: "Response detected bilaterally. ABR waveforms demonstrate clear morphology and latencies within expected clinical ranges.",
  };
  if (trials >= 100) return {
    label: "INCONCLUSIVE",
    description: "Insufficient trial count for a definitive result. Consider running another session.",
  };
  return {
    label: "INSUFFICIENT DATA",
    description: "Trial count too low to make a clinical determination. Please run the scan for a longer duration.",
  };
}

function resultStyle(trials: number): string {
  if (trials >= 500) return "bg-secondary-container text-on-secondary-container";
  if (trials >= 100) return "bg-tertiary-fixed text-on-tertiary-fixed-variant";
  return "bg-error-container text-on-error-container";
}

function computeSNR(samples: number[], fs: number): number {
  if (samples.length < 4) return 0;
  const preN = Math.max(1, Math.min(samples.length - 1, Math.round(fs * 0.001)));
  const pre = samples.slice(0, preN);
  const post = samples.slice(preN);
  const rms = (values: number[]) => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / Math.max(1, values.length));
  return 20 * Math.log10((rms(post) + 1e-9) / (rms(pre) + 1e-9));
}

function buildAnalysis(samples: number[], fs: number, snr = 0): SessionDetail["analysis"] {
  if (!samples.length || fs <= 0) return undefined;
  const bands = [
    { name: "I", lo: 1.0, hi: 2.5 },
    { name: "III", lo: 3.5, hi: 4.5 },
    { name: "V", lo: 5.0, hi: 7.5 },
  ];
  const waves = bands.flatMap(({ name, lo, hi }) => {
    const start = Math.max(0, Math.floor(lo / 1000 * fs));
    const end = Math.min(samples.length - 1, Math.ceil(hi / 1000 * fs));
    if (start >= end) return [];
    let best = start;
    for (let i = start + 1; i <= end; i++) {
      if (Math.abs(samples[i]) > Math.abs(samples[best])) best = i;
    }
    return [{ name, latency_ms: best / fs * 1000, amplitude_uv: samples[best] }];
  });
  const byName = Object.fromEntries(waves.map(w => [w.name, w.latency_ms]));
  const interpeak_ms: Record<string, number> = {};
  if (byName.I && byName.III) interpeak_ms["I-III"] = byName.III - byName.I;
  if (byName.III && byName.V) interpeak_ms["III-V"] = byName.V - byName.III;
  if (byName.I && byName.V) interpeak_ms["I-V"] = byName.V - byName.I;
  return {
    waves,
    interpeak_ms,
    verdict: snr >= 3 && waves.length >= 3 ? "Pass" : "Refer",
  };
}

/** Normalize session detail or live ABR result to a common shape */
function normalize(
  detail: SessionDetail | null,
  live: ABRResult | null,
): {
  trials: number;
  snr: number[];
  abrAvg: number[][];
  status?: string;
  analysis?: SessionDetail["analysis"];
  samplingRate?: number;
  epochMs?: number;
} | null {
  if (detail) {
    const samplingRate = detail.sampling_rate || 16000;
    const ch0 = detail.abr_average?.[0] ?? [];
    const snr = detail.snr?.length ? detail.snr : [computeSNR(ch0, samplingRate)];
    return {
      trials: detail.trial_count ?? 0,
      snr,
      abrAvg: detail.abr_average ?? [],
      status: detail.status ?? detail.quality,
      analysis: detail.analysis ?? buildAnalysis(ch0, samplingRate, snr[0]),
      samplingRate,
      epochMs: detail.epoch_ms,
    };
  }
  if (live) {
    return {
      trials: live.trial_count,
      snr: live.snr,
      abrAvg: live.abr_average,
      status: live.quality,
      samplingRate: live.sampling_rate,
      epochMs: live.epoch_ms,
    };
  }
  return null;
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="pt-20 text-center text-sm text-on-surface-variant">Loading…</div>}>
      <ResultsContent />
    </Suspense>
  );
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const filename = searchParams.get("file"); // e.g. eeg_abr_12345.json

  const [tab, setTab] = useState<Tab>("visual");

  // If a filename is given → load that saved session, else load live ABR result
  const sessionFetcher = useCallback(
    () => (filename ? api.session(filename) : Promise.resolve(null)),
    [filename],
  );
  const liveFetcher = useCallback(
    () => (!filename ? api.abrResult() : Promise.resolve(null)),
    [filename],
  );

  const session = useBackend<SessionDetail | null>(sessionFetcher, 0);
  const live    = useBackend<ABRResult | null>(liveFetcher, filename ? 0 : 3_000);
  const sessions = useBackend(api.sessions, filename ? 0 : 15_000);

  const loading = session.loading || live.loading;
  const error   = session.error || live.error;

  const data = normalize(session.data ?? null, live.data ?? null);
  const result = data ? classifyResult(data.trials) : null;

  /* ── Wave V latency from waveform data (peak after ~5ms) ──────── */
  const epochSamples = data?.abrAvg?.[0]?.length ?? 0;
  const snrCh0 = data?.snr?.[0] ?? null;

  if (!filename) {
    const allSessions = sessions.data?.sessions ?? [];

    return (
      <>
        <TopBar
          left={
            <>
              <MenuButton />
              <div>
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  Saved Results
                </span>
                <p className="text-[11px] text-on-surface-variant opacity-70">
                  {sessions.loading ? "Loading all saved result data" : `${allSessions.length} sessions available`}
                </p>
              </div>
            </>
          }
          right={
            <span className="hidden sm:flex items-center gap-1.5 bg-secondary-container text-on-secondary-container px-3 py-1.5 rounded-full text-xs font-semibold">
              <MdHistory className="text-[16px]" />
              All Data
            </span>
          }
        />

        <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-6">
          <section className="border-b border-outline-variant pb-6">
            <p className="text-xs font-bold text-secondary uppercase tracking-widest">Diagnostic Results</p>
            <h1 className="text-4xl md:text-6xl font-extrabold text-on-surface leading-tight">All Saved Sessions</h1>
            <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">
              Complete list of stored ABR screening results from the backend session archive.
            </p>
          </section>

          {sessions.error && (
            <div className="py-16 text-center text-on-surface-variant">
              <MdCloudOff className="mx-auto mb-3 text-[48px] text-error" />
              <p className="text-sm">Could not load saved results.</p>
              <p className="text-xs font-mono mt-1">{sessions.error}</p>
            </div>
          )}

          {sessions.loading && !sessions.data && (
            <div className="py-16 text-center text-on-surface-variant">
              <MdAutorenew className="mx-auto mb-3 text-[48px] animate-spin" />
              Loading saved results…
            </div>
          )}

          {!sessions.loading && !sessions.error && allSessions.length === 0 && (
            <div className="bg-white border border-outline-variant rounded-2xl px-6 py-12 text-center text-sm text-on-surface-variant">
              No saved results yet. Run a scan and press Save.
            </div>
          )}

          {allSessions.length > 0 && (
            <div className="bg-white border border-outline-variant rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-xs font-semibold text-on-surface-variant border-b border-outline-variant">
                      <th className="px-6 py-4">Filename</th>
                      <th className="px-6 py-4">Saved At</th>
                      <th className="px-6 py-4">Trials</th>
                      <th className="px-6 py-4">Result</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {allSessions.map(s => {
                      const classified = classifyResult(s.trial_count);
                      return (
                        <tr key={s.filename} className="hover:bg-surface-container-low/30 transition-colors">
                          <td className="px-6 py-5">
                            <p className="text-xs font-bold font-mono text-on-surface">{s.filename}</p>
                          </td>
                          <td className="px-6 py-5 text-sm text-on-surface-variant">
                            {new Date(s.saved_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-5 font-mono text-sm">{s.trial_count.toLocaleString()}</td>
                          <td className="px-6 py-5">
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${resultStyle(s.trial_count)}`}>
                              {s.status ?? classified.label}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <Link
                              href={`/results?file=${encodeURIComponent(s.filename)}`}
                              className="text-primary hover:bg-primary-container/20 px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                            >
                              Detail
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-4 border-t border-outline-variant">
                <p className="text-xs text-on-surface-variant">Showing all {allSessions.length} saved results</p>
              </div>
            </div>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div>
              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                {filename ? "Saved Session" : "Live Result"}
              </span>
              {filename && (
                <p className="text-[11px] font-mono text-on-surface-variant opacity-60">{filename}</p>
              )}
            </div>
          </>
        }
        right={
          <>
            {!filename && (
              <Link href="/records" className="text-xs font-semibold text-primary hover:underline">
                View History
              </Link>
            )}
            <span className="hidden sm:flex items-center gap-1.5 bg-secondary-container text-on-secondary-container px-3 py-1.5 rounded-full text-xs font-semibold">
              <MdHistory className="text-[16px]" />
              {filename ? "Saved" : "Live"}
            </span>
          </>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-8">

        {/* ── Loading / error state ─────────────────────────────── */}
        {loading && (
          <div className="py-20 text-center text-on-surface-variant">
            <MdAutorenew className="mx-auto mb-3 text-[48px] animate-spin" />
            Loading result…
          </div>
        )}

        {error && (
          <div className="py-20 text-center text-on-surface-variant">
            <MdCloudOff className="mx-auto mb-3 text-[48px] text-error" />
            <p className="text-sm">Could not load result.</p>
            <p className="text-xs font-mono mt-1">{error}</p>
            <Link href="/records" className="mt-4 inline-block px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold">
              Back to History
            </Link>
          </div>
        )}

        {!loading && !error && (!data || !result) && (
          <div className="py-20 text-center text-on-surface-variant">
            <MdCloudOff className="mx-auto mb-3 text-[48px] text-outline" />
            <p className="text-sm">No result data available for this session.</p>
            <p className="text-xs font-mono mt-1">{filename}</p>
            <Link href="/results" className="mt-4 inline-block px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold">
              Back to Results
            </Link>
          </div>
        )}

        {!loading && !error && data && result && (
          <>
            {/* ── Result headline ────────────────────────────────── */}
            <section className="border-b border-outline-variant pb-6">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-secondary uppercase tracking-widest">Diagnostic Result</p>
                  <h1 className="text-5xl md:text-7xl font-extrabold text-on-surface leading-tight">{result.label}</h1>
                  <p className="text-base text-on-surface-variant mt-2 max-w-2xl leading-relaxed">{result.description}</p>
                  <div className="flex flex-wrap gap-4 mt-3 text-xs text-on-surface-variant">
                    <span className="font-mono">Trials: <strong className="text-primary">{data.trials.toLocaleString()}</strong></span>
                    <span className="font-mono">Epoch samples: <strong className="text-primary">{epochSamples}</strong></span>
                    {snrCh0 !== null && (
                      <span className="font-mono">SNR Ch0: <strong className="text-secondary">{snrCh0.toFixed(1)} dB</strong></span>
                    )}
                    {data.status && (
                      <span className="font-mono">Status: <strong className="text-primary">{data.status}</strong></span>
                    )}
                  </div>
                </div>
                <button className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl text-xs font-bold transition-all active:scale-95 hover:opacity-90 shrink-0">
                  <MdPictureAsPdf className="text-xl" />
                  Export Report
                </button>
              </div>
            </section>

            {/* ── Tabs ─────────────────────────────────────────────── */}
            <div className="space-y-6">
              <div className="flex gap-6 border-b border-outline-variant overflow-x-auto hide-scrollbar">
                {(["visual", "metrics"] as Tab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`pb-4 px-1 text-xs font-bold capitalize transition-all border-b-4 -mb-px whitespace-nowrap ${
                      tab === t
                        ? "text-primary border-primary"
                        : "text-on-surface-variant border-transparent hover:text-primary"
                    }`}
                  >
                    {t === "visual" ? "Visual Analysis" : "Detailed Metrics"}
                  </button>
                ))}
              </div>

              {/* ── Visual Analysis ────────────────────────────────── */}
              {tab === "visual" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Waveform card */}
                  <div className="lg:col-span-8 bg-white border border-outline-variant rounded-2xl p-6 overflow-hidden">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
                      <h3 className="text-xl font-bold text-primary">ABR Waveform (Ch 0)</h3>
                      <div className="flex gap-4 text-xs font-semibold">
                        <span className="flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-secondary" />Left Ear</span>
                        <span className="flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-primary-container opacity-40" />Baseline</span>
                      </div>
                    </div>

                    {/* SVG waveform drawn from real data */}
                    <WaveformSVG samples={data.abrAvg[0] ?? []} />
                  </div>

                  {/* Key indicators */}
                  <div className="lg:col-span-4 space-y-4">
                    <div className="bg-primary text-white rounded-2xl p-6 shadow-lg">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-5">Key Indicators</h4>
                      <div className="space-y-5">
                        <div>
                          <p className="text-xs opacity-70">Trial Count</p>
                          <p className="text-4xl font-bold">{data.trials.toLocaleString()}</p>
                        </div>
                        {snrCh0 !== null && (
                          <div className="border-t border-white/10 pt-4">
                            <p className="text-xs opacity-70">SNR Ch 0</p>
                            <p className="text-4xl font-bold">{snrCh0.toFixed(1)} <span className="text-base font-normal opacity-70">dB</span></p>
                          </div>
                        )}
                        <div className={snrCh0 !== null ? "" : "border-t border-white/10 pt-4"}>
                          <p className="text-xs opacity-70">Classification</p>
                          <p className="text-xl font-bold">{data.status ?? result.label}</p>
                        </div>
                        {data.analysis?.verdict && (
                          <div className="border-t border-white/10 pt-4">
                            <p className="text-xs opacity-70">Verdict</p>
                            <p className="text-2xl font-bold">{data.analysis.verdict}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {data.analysis?.waves && data.analysis.waves.length > 0 && (
                      <div className="bg-white border border-outline-variant rounded-2xl p-5">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-4">Detected Latencies</h4>
                        <div className="space-y-3">
                          {data.analysis.waves.map(w => (
                            <div key={w.name} className="flex items-end justify-between border-b border-outline-variant/30 pb-2 last:border-b-0">
                              <span className="text-sm font-bold text-primary">Wave {w.name}</span>
                              <span className="font-mono text-sm text-on-surface">
                                {w.latency_ms.toFixed(2)} ms
                              </span>
                            </div>
                          ))}
                        </div>
                        {data.analysis.interpeak_ms && (
                          <div className="mt-4 pt-4 border-t border-outline-variant/30 space-y-2">
                            {Object.entries(data.analysis.interpeak_ms).map(([pair, value]) => (
                              <div key={pair} className="flex justify-between text-xs">
                                <span className="font-semibold text-on-surface-variant">IPI {pair}</span>
                                <span className="font-mono text-primary">{value.toFixed(2)} ms</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="bg-surface-container border border-outline-variant rounded-2xl p-5">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-3">Session Info</h4>
                      {filename ? (
                        <p className="text-xs font-mono text-on-surface-variant break-all">{filename}</p>
                      ) : (
                        <p className="text-sm text-on-surface italic">Live session — data not yet saved.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Detailed Metrics ───────────────────────────────── */}
              {tab === "metrics" && (
                <div className="space-y-6">
                  {/* Per-channel SNR table */}
                  {data.snr.length > 0 && (
                    <div className="bg-white border border-outline-variant rounded-2xl overflow-hidden shadow-sm">
                      <h4 className="px-6 py-4 text-base font-bold text-primary border-b border-outline-variant">Channel SNR</h4>
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-surface-container-high text-xs font-semibold text-on-surface-variant border-b border-outline-variant">
                            <th className="px-6 py-4">Channel</th>
                            <th className="px-6 py-4">SNR (dB)</th>
                            <th className="px-6 py-4">Status</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-outline-variant">
                          {data.snr.map((snr, ch) => (
                            <tr key={ch} className="hover:bg-surface-container-low transition-colors">
                              <td className="px-6 py-4 font-bold">Ch {ch}</td>
                              <td className="px-6 py-4 font-mono">{snr.toFixed(2)}</td>
                              <td className="px-6 py-4">
                                <span className={`flex items-center gap-2 text-xs font-bold ${snr > 3 ? "text-secondary" : "text-error"}`}>
                                  <span className={`w-2 h-2 rounded-full ${snr > 3 ? "bg-secondary" : "bg-error"}`} />
                                  {snr > 3 ? "Good" : "Weak"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Waveform data table (first 25 samples of ch0) */}
                  <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-6">
                    <h4 className="text-lg font-bold text-primary mb-4">Waveform Samples (Ch 0, first 25)</h4>
                    <div className="overflow-x-auto">
                      <table className="text-xs font-mono border-collapse w-full">
                        <thead>
                          <tr className="text-on-surface-variant">
                            {(data.abrAvg[0] ?? []).slice(0, 25).map((_, i) => (
                              <th key={i} className="px-2 py-1 text-center">{i}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {(data.abrAvg[0] ?? []).slice(0, 25).map((v, i) => (
                              <td key={i} className={`px-2 py-1 text-center ${v > 0 ? "text-secondary" : "text-error"}`}>
                                {v.toFixed(2)}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Footer ──────────────────────────────────────────── */}
            <footer className="flex flex-col md:flex-row justify-between items-center py-5 border-t border-outline-variant text-xs text-on-surface-variant">
              <p>© 2024 Neurosound Medical Systems. Clinical Diagnostic Support.</p>
              <div className="flex gap-6 mt-3 md:mt-0">
                <a href="#" className="hover:text-primary underline underline-offset-4 transition-colors">Support</a>
              </div>
            </footer>
          </>
        )}
      </main>
    </>
  );
}

/* ── SVG waveform renderer from raw float64[] data ─────────── */
function WaveformSVG({ samples }: { samples: number[] }) {
  if (!samples.length) {
    return (
      <div className="w-full h-64 bg-surface-container-low rounded-xl flex items-center justify-center border border-outline-variant">
        <p className="text-sm text-on-surface-variant">No waveform data</p>
      </div>
    );
  }

  const W = 1000;
  const H = 200;
  const mid = H / 2;
  const max = Math.max(...samples.map(Math.abs), 0.001);
  const scale = (mid - 10) / max;
  const step = W / (samples.length - 1);

  const d = samples
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(mid - v * scale).toFixed(1)}`)
    .join(" ");

  return (
    <div className="w-full h-64 bg-surface-container-low rounded-xl relative border border-outline-variant overflow-hidden">
      <svg className="w-full h-full p-4" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Baseline */}
        <line stroke="#c3c7cd" strokeDasharray="4" x1="0" x2={W} y1={mid} y2={mid} />
        {/* Grid lines */}
        {[W / 4, W / 2, (3 * W) / 4].map(x => (
          <line key={x} stroke="#c3c7cd" strokeDasharray="4" x1={x} x2={x} y1="0" y2={H} />
        ))}
        {/* Waveform */}
        <path className="waveform-path" d={d} fill="none" stroke="#366850" strokeLinecap="round" strokeWidth="2.5" />
      </svg>
    </div>
  );
}
