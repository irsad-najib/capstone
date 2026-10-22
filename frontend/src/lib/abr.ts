/**
 * Helper ABR yang dipakai banyak halaman: sumbu waktu epoch, klasifikasi
 * hasil, dan penyaringan gelombang. Aturan mengikuti neurosound-backend:
 *   - status DSP: Noise (<100 trial) → Terbentuk → Konvergen (≥500 & r≥0.9)
 *   - verdict: Pass jika Konvergen, SNR ≥ 3 dB, dan gelombang I/III/V terdeteksi
 */
import type { Analysis, WaveInfo } from "@/lib/api";

export const MIN_TRIALS     = 100;   // di bawah ini → Insufficient
export const TARGET_TRIALS  = 500;   // backend butuh ≥500 untuk Konvergen
export const SNR_GOOD_DB    = 3;
export const WAVE_V_WINDOW  = [5.0, 7.5] as const; // ms, sama dengan waveBands backend

/** Epoch backend dimulai pre_stim_ms sebelum stimulus. Sesi lama belum menyimpan field ini. */
export function preStimMs(d: { pre_stim_ms?: number; epoch_ms?: number }): number {
  if (d.pre_stim_ms != null) return d.pre_stim_ms;
  return d.epoch_ms === 60 ? 10 : 0;
}

/** Waktu (ms, relatif onset stimulus) untuk sampel ke-i. */
export function sampleTimeMs(i: number, fs: number, preMs: number): number {
  return (i / fs) * 1000 - preMs;
}

/** Buang gelombang kosong (amplitudo 0 = average belum terisi). */
export function validWaves(waves?: WaveInfo[] | null): WaveInfo[] {
  return (waves ?? []).filter(w => w.amplitude_uv !== 0 && Number.isFinite(w.latency_ms));
}

export type Outcome = "Pass" | "Refer" | "Inconclusive" | "Insufficient";

/**
 * Hasil yang ditampilkan. Verdict "Refer" dari backend baru final setelah
 * status Konvergen; sebelum itu hasilnya belum bisa disimpulkan.
 */
export function outcomeOf(r: { trial_count: number; status?: string; verdict?: string }): Outcome {
  if (r.trial_count < MIN_TRIALS) return "Insufficient";
  if (r.status !== "Konvergen") return "Inconclusive";
  return r.verdict === "Pass" ? "Pass" : "Refer";
}

export const OUTCOME_INFO: Record<Outcome, { label: string; icon: string; chip: string; dot: string; text: string; description: string }> = {
  Pass: {
    label: "Pass", icon: "✓",
    chip: "bg-secondary-container text-on-secondary-container",
    dot: "bg-secondary", text: "text-secondary",
    description: "Wave V is present with enough SNR and the average has converged — the auditory pathway responded to the stimulus.",
  },
  Refer: {
    label: "Refer", icon: "↗",
    chip: "bg-error-container text-on-error-container",
    dot: "bg-error", text: "text-error",
    description: "The average converged but no clear response was found. Refer to a specialist for a full assessment.",
  },
  Inconclusive: {
    label: "Inconclusive", icon: "?",
    chip: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
    dot: "bg-on-tertiary-container", text: "text-on-tertiary-container",
    description: "The average has not converged yet (needs ≥500 trials and r ≥ 0.9). Continue or repeat the scan.",
  },
  Insufficient: {
    label: "Insufficient", icon: "–",
    chip: "bg-surface-container-high text-on-surface-variant",
    dot: "bg-outline", text: "text-on-surface-variant",
    description: "Fewer than 100 trials — too few to judge a response.",
  },
};

/** Status DSP backend dalam bahasa yang lebih jelas. */
export function statusLabel(status?: string): string {
  switch (status) {
    case "Konvergen": return "Konvergen";
    case "Terbentuk": return "Terbentuk";
    case "Noise":     return "Noise";
    default:          return status || "—";
  }
}

/**
 * Deteksi puncak untuk sesi lama yang belum punya `analysis`.
 * Sama dengan analysis.detectWaves di backend: |amplitudo| maksimum per jendela.
 */
export function detectWaves(avg: number[], fs: number, preMs: number): Analysis {
  const bands: [string, number, number][] = [["I", 1.0, 2.5], ["III", 3.5, 4.5], ["V", 5.0, 7.5]];
  const offset = Math.round((preMs / 1000) * fs);
  const waves: WaveInfo[] = [];
  for (const [name, lo, hi] of bands) {
    const start = offset + Math.floor((lo / 1000) * fs);
    const end   = Math.min(avg.length - 1, offset + Math.floor((hi / 1000) * fs));
    if (start >= end) continue;
    let best = start;
    for (let i = start + 1; i <= end; i++) if (Math.abs(avg[i]) > Math.abs(avg[best])) best = i;
    if (avg[best] === 0) continue;
    waves.push({ name, latency_ms: ((best - offset) / fs) * 1000, amplitude_uv: avg[best] });
  }
  const lat = Object.fromEntries(waves.map(w => [w.name, w.latency_ms]));
  const interpeak_ms: Record<string, number> = {};
  if (lat.I && lat.III) interpeak_ms["I-III"] = lat.III - lat.I;
  if (lat.III && lat.V) interpeak_ms["III-V"] = lat.V - lat.III;
  if (lat.I && lat.V)   interpeak_ms["I-V"]   = lat.V - lat.I;
  return { waves, interpeak_ms };
}

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatAgo(iso?: string, now = Date.now()): string {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000)       return `${Math.max(0, Math.round(ms))} ms ago`;
  if (ms < 60_000)     return `${Math.round(ms / 1000)} s ago`;
  if (ms < 3_600_000)  return `${Math.round(ms / 60_000)} min ago`;
  return `${Math.round(ms / 3_600_000)} h ago`;
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
