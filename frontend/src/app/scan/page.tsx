"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import RawWaveformChart from "@/components/RawWaveformChart";
import { useABRStream } from "@/hooks/useABRStream";
import MenuButton from "@/components/MenuButton";
import { MdPause, MdPlayArrow, MdRefresh, MdSave, MdStop, MdTimer } from "react-icons/md";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

type Tab = "abr" | "raw";

export default function ScanPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("abr");
  const [saving, setSaving] = useState(false);

  const {
    status, devices, rawWave, rawStim,
    abrResult, stimCount, frameCount, currentMv, currentRaw,
    recentFrames, paused, setPaused, resetABR,
  } = useABRStream();

  // Reset semua state saat meninggalkan halaman scan
  useEffect(() => {
    return () => { resetABR(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLive     = status === "live";
  const deviceName = devices[0] ?? "esp32-abr-001";
  const snrCh0     = abrResult.snr[0] ?? 0;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${BACKEND}/api/v1/abr/save`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const d = await res.json();
      if (!d.file) throw new Error("Backend did not return saved filename");
      router.push(`/results?file=${encodeURIComponent(d.file)}`);
    } catch {
      alert("Backend offline — tidak bisa menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-primary">Neurosound</span>
              {isLive ? (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-secondary-container text-on-secondary-container rounded-lg text-[11px] font-bold">
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  LIVE — {deviceName}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-surface-container border border-outline-variant text-on-surface-variant rounded-lg text-[11px] font-bold">
                  <span className="w-2 h-2 rounded-full bg-outline-variant" />
                  {status === "connecting" ? "CONNECTING…" : "SIMULATION"}
                </span>
              )}
            </div>
          </>
        }
        right={
          <div className="hidden md:flex items-center gap-4 text-xs text-on-surface-variant font-mono">
            <span>Trials: <strong className="text-primary">{abrResult.trial_count.toLocaleString()}</strong></span>
            <span>Stim: <strong className="text-secondary">{stimCount}</strong></span>
            <span>SNR: <strong className="text-secondary">{snrCh0.toFixed(1)} dB</strong></span>
            <span className={`font-medium ${currentMv >= 0 ? "text-secondary" : "text-error"}`}>
              {currentMv >= 0 ? "+" : ""}{currentMv.toFixed(3)} mV
            </span>
          </div>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 bg-surface min-h-screen">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* ── Page header + controls ──────────────────────────── */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded-md bg-error text-white text-[11px] font-bold pulse-red tracking-widest uppercase">
                  Live Scan
                </span>
                <h2 className="text-xl font-bold text-primary">Auditory Brainstem Response</h2>
              </div>
              <p className="text-sm text-on-surface-variant">
                Click (80 dB nHL, 11.1/s) · Fz – A2 Differential
              </p>
            </div>
            <div className="flex gap-2 w-full lg:w-auto">
              <button
                onClick={() => setPaused(!paused)}
                className={`flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${
                  paused
                    ? "bg-secondary text-white border-secondary hover:opacity-90"
                    : "bg-white border-outline-variant text-primary hover:bg-surface-container"
                }`}
              >
                {paused ? <MdPlayArrow className="text-[18px]" /> : <MdPause className="text-[18px]" />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={resetABR}
                className="flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 bg-white border border-outline-variant rounded-xl text-on-surface-variant text-xs font-bold hover:bg-surface-container transition-all active:scale-95"
              >
                <MdRefresh className="text-[18px]" />Reset
              </button>
              <button
                onClick={() => { setPaused(true); resetABR(); }}
                className="flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 bg-error text-white rounded-xl text-xs font-bold hover:opacity-90 transition-all active:scale-95"
              >
                <MdStop className="text-[18px]" />Stop
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 bg-secondary text-white rounded-xl text-xs font-bold hover:opacity-90 transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100"
              >
                <MdSave className="text-[18px]" />{saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {/* ── Main grid ──────────────────────────────────────── */}
          <div className="grid grid-cols-12 gap-6">

            {/* ABR Waveform panel */}
            <div className="col-span-12 lg:col-span-9 bg-white border border-outline-variant rounded-xl p-6 flex flex-col">

              {/* Tabs */}
              <div className="flex gap-0 border-b border-outline-variant mb-4">
                {([
                  { key: "abr" as Tab, label: "Averaged ABR Waveform" },
                  { key: "raw" as Tab, label: "Raw EEG Stream" },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-5 py-2.5 text-xs font-bold border-b-2 transition-colors -mb-px ${
                      tab === key
                        ? "border-secondary text-secondary"
                        : "border-transparent text-on-surface-variant hover:text-primary hover:bg-surface-container-low"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2 pr-2 text-[11px] text-on-surface-variant font-mono">
                  <span>Frame #{frameCount.toLocaleString()}</span>
                  <span className={`w-2 h-2 rounded-full ${isLive ? "bg-secondary animate-pulse" : "bg-outline-variant"}`} />
                </div>
              </div>

              {/* Chart area */}
              {tab === "abr" && (
                <div className="flex-1 flex flex-col min-h-80">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                        Averaged ABR — Channel 0 (Running Average)
                      </p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Epoch 50ms · Bandpass 100–408 Hz · FiltFilt zero-phase
                      </p>
                    </div>
                    <div className="flex gap-4 text-[11px] text-on-surface-variant">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-6 h-0.5 bg-secondary" />ABR avg
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-6 h-0.5 bg-outline-variant" />Noise
                      </span>
                    </div>
                  </div>
                  <ABRWaveformChart result={abrResult} channel={0} />
                  <div className="mt-3 flex flex-wrap gap-4">
                    {["Wave I (~1ms)", "Wave III (~3.5ms)", "Wave V (~5.5ms)"].map(w => (
                      <div key={w} className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-secondary-fixed-dim rounded-full" />
                        <span className="text-xs text-on-surface-variant">{w}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "raw" && (
                <div className="flex-1 flex flex-col gap-3">
                  {/* Subheader */}
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                        Raw ADC — ADS1115 Ch0 (mV)
                      </p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Window 500ms · 860 SPS
                        {paused && <span className="ml-2 px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container text-[10px] font-bold">PAUSED</span>}
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <p className={`text-lg font-bold ${currentMv >= 0 ? "text-secondary" : "text-error"}`}>
                        {currentMv >= 0 ? "+" : ""}{currentMv.toFixed(3)} mV
                      </p>
                      <p className="text-xs text-on-surface-variant">raw: {currentRaw}</p>
                    </div>
                  </div>
                  {/* Dark canvas */}
                  <RawWaveformChart
                    waveBuf={rawWave}
                    stimBuf={rawStim}
                    currentMv={currentMv}
                    currentRaw={currentRaw}
                  />

                </div>
              )}
            </div>

            {/* Right panel: latencies + scan health */}
            <div className="col-span-12 lg:col-span-3 space-y-6">

              {/* Latencies */}
              <div className="bg-primary-container text-on-primary-container rounded-xl p-5 border border-primary/20 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest opacity-70">Latencies</h3>
                  <MdTimer className="text-[18px]" />
                </div>
                {(["I", "III", "V"] as const).map((name) => {
                  const wave = abrResult.analysis?.waves?.find(w => w.name === name);
                  const val  = wave ? wave.latency_ms.toFixed(2) : "—";
                  return (
                    <div key={name} className="bg-white/10 px-4 py-3 rounded-lg flex justify-between items-end border border-on-primary-container/20">
                      <span className="text-sm font-bold">WAVE {name}</span>
                      <span className="text-xl font-bold">
                        {val} <span className="text-xs font-normal opacity-60">ms</span>
                      </span>
                    </div>
                  );
                })}
                {(() => {
                  const iv = abrResult.analysis?.interpeak_ms?.["I-V"];
                  return (
                    <div className="bg-secondary-container text-on-secondary-container px-4 py-3 rounded-lg flex justify-between items-end border border-secondary/20">
                      <span className="text-sm font-bold">I–V INT.</span>
                      <span className="text-xl font-bold">
                        {iv != null ? iv.toFixed(2) : "—"} <span className="text-xs font-normal opacity-60">ms</span>
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Scan health */}
              <div className="bg-surface-container-highest rounded-xl p-5 border border-outline-variant space-y-4">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Scan Health</h3>
                <div>
                  <div className="flex justify-between items-end mb-1.5">
                    <span className="text-sm font-semibold">SNR Ratio</span>
                    <span className="text-xl font-bold text-secondary">{snrCh0.toFixed(1)} <span className="text-xs font-normal">dB</span></span>
                  </div>
                  <div className="w-full h-3 bg-outline-variant/30 rounded-full overflow-hidden">
                    <div className="h-full bg-secondary transition-all" style={{ width: `${Math.min(100, snrCh0 * 7)}%` }} />
                  </div>
                </div>
                <div className="flex justify-between items-center py-3 border-t border-outline-variant/30">
                  <span className="text-sm font-semibold">Quality</span>
                  <span className="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-full text-xs font-bold">
                    {abrResult.quality ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold">Trials</span>
                  <span className="text-sm font-bold text-primary">{abrResult.trial_count.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Status bar ─────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-primary-container p-5 rounded-xl text-on-primary-container">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div>
                <p className="font-bold uppercase tracking-wider opacity-60 text-[10px]">Status</p>
                <p className="font-semibold">{isLive ? "🟢 Backend Connected" : "🟡 Simulation Mode"}</p>
              </div>
              <div className="h-8 w-px bg-on-primary-container/20 hidden sm:block" />
              <div>
                <p className="font-bold uppercase tracking-wider opacity-60 text-[10px]">Backend</p>
                <p className="font-mono">{BACKEND}</p>
              </div>
              <div className="h-8 w-px bg-on-primary-container/20 hidden sm:block" />
              <div>
                <p className="font-bold uppercase tracking-wider opacity-60 text-[10px]">Quality</p>
                <p className="font-semibold">{abrResult.quality}</p>
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="shrink-0 px-6 py-2.5 bg-secondary text-white rounded-xl text-xs font-bold hover:opacity-90 transition-colors disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Session"}
            </button>
          </div>

        </div>
      </main>
    </>
  );
}
