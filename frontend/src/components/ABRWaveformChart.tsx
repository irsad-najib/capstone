"use client";
import { useCanvas, niceCeil, fmtUv } from "@/hooks/useCanvas";
import { preStimMs, sampleTimeMs, validWaves, WAVE_V_WINDOW } from "@/lib/abr";
import type { Analysis } from "@/lib/api";

export interface ABRChartData {
  abr_average:   number[][];
  sampling_rate: number;
  epoch_ms:      number;
  pre_stim_ms?:  number;
  trial_count:   number;
  analysis?:     Analysis;
}

interface Props {
  data:      ABRChartData;
  /** Channel yang digambar (0 = Ch 1, 1 = Ch 2). */
  channels?: number[];
  /** Rata-rata sebelumnya untuk channel pertama (garis samar). */
  ghost?:    number[] | null;
  /** Rentang waktu (ms relatif stimulus). Default 0–10 ms. */
  range?:    [number, number];
  height?:   number;
  compact?:  boolean;
}

const CH_COLOR = ["secondary", "primary-container"];

export default function ABRWaveformChart({
  data, channels = [0], ghost = null, range = [0, 10], height = 280, compact = false,
}: Props) {
  const ref = useCanvas((ctx, W, H, color) => {
    const fs = data.sampling_rate || 16000;
    const pre = preStimMs(data);
    const [t0, t1] = range;
    const PAD = compact ? { l: 34, r: 8, t: 8, b: 18 } : { l: 52, r: 14, t: 18, b: 30 };
    const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;
    const xOf = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * PW;
    const font = (px: number, w = 400) => `${w} ${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    // Indeks sampel di dalam rentang waktu
    const iOf = (t: number) => Math.round(((t + pre) / 1000) * fs);
    const avgs = channels.map(ch => data.abr_average?.[ch] ?? []);
    const len = Math.max(0, ...avgs.map(a => a.length));
    const i0 = Math.max(0, iOf(t0)), i1 = Math.min(len - 1, iOf(t1));

    if (data.trial_count === 0 || len === 0) {
      ctx.fillStyle = color("on-surface-variant");
      ctx.font = "13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for the first trial…", W / 2, H / 2);
      return;
    }

    // Skala Y simetris, minimal ±0.5 µV
    let maxAbs = 0;
    for (const a of [...avgs, ghost ?? []]) for (let i = i0; i <= i1 && i < a.length; i++) maxAbs = Math.max(maxAbs, Math.abs(a[i]));
    const yMax = niceCeil(Math.max(0.5, maxAbs * 1.1));
    const mid = PAD.t + PH / 2;
    const yOf = (v: number) => mid - (v / yMax) * (PH / 2);

    // Jendela Wave V
    const [v0, v1] = WAVE_V_WINDOW;
    if (v1 > t0 && v0 < t1) {
      ctx.fillStyle = color("secondary-container");
      ctx.globalAlpha = 0.45;
      ctx.fillRect(xOf(Math.max(v0, t0)), PAD.t, xOf(Math.min(v1, t1)) - xOf(Math.max(v0, t0)), PH);
      ctx.globalAlpha = 1;
    }

    // Grid
    ctx.strokeStyle = color("outline-variant");
    ctx.lineWidth = 1;
    ctx.fillStyle = color("on-surface-variant");
    ctx.font = font(compact ? 9 : 10);
    ctx.textAlign = "right";
    for (const v of [-yMax, -yMax / 2, 0, yMax / 2, yMax]) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.globalAlpha = v === 0 ? 0.9 : 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.globalAlpha = 1;
      if (!compact || v !== 0) ctx.fillText(`${v > 0 ? "+" : ""}${fmtUv(v)}`, PAD.l - 4, y + 3);
    }
    const span = t1 - t0;
    const step = span <= 12 ? (compact ? 5 : 1) : span <= 30 ? 5 : 10;
    ctx.textAlign = "center";
    for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) {
      const x = Math.round(xOf(t)) + 0.5;
      ctx.globalAlpha = t === 0 ? 0.9 : 0.35;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + PH); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(`${t}`, x, H - PAD.b + (compact ? 12 : 14));
    }
    if (!compact) {
      ctx.textAlign = "left";
      ctx.fillText("µV", 4, PAD.t + 4);
      ctx.textAlign = "right";
      ctx.fillText("ms", W - PAD.r, H - 4);
    }

    const trace = (a: number[], stroke: string, width: number, alpha = 1) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      ctx.lineJoin = "round";
      ctx.beginPath();
      // Desimasi ringan: maksimal ~2 titik per piksel
      const stride = Math.max(1, Math.floor((i1 - i0) / (PW * 2)));
      for (let i = i0; i <= i1 && i < a.length; i += stride) {
        const x = xOf(sampleTimeMs(i, fs, pre));
        const y = Math.max(PAD.t, Math.min(PAD.t + PH, yOf(a[i])));
        if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    if (ghost?.length) trace(ghost, color("outline"), 1.25, 0.5);
    avgs.forEach((a, k) => trace(a, color(CH_COLOR[channels[k]] ?? "secondary"), compact ? 1.5 : 2));

    // Penanda gelombang (dari analisis Ch 1)
    if (channels.includes(0)) {
      const waves = validWaves(data.analysis?.waves);
      ctx.font = font(compact ? 9 : 10, 700);
      ctx.textAlign = "center";
      for (const w of waves) {
        if (w.latency_ms < t0 || w.latency_ms > t1) continue;
        const x = xOf(w.latency_ms);
        const y = Math.max(PAD.t + 14, Math.min(PAD.t + PH, yOf(w.amplitude_uv)));
        ctx.fillStyle = color("on-tertiary-container");
        ctx.beginPath(); ctx.arc(x, y, compact ? 2.5 : 3.5, 0, Math.PI * 2); ctx.fill();
        const label = compact ? w.name : `${w.name} ${w.latency_ms.toFixed(2)}`;
        ctx.fillText(label, x, w.amplitude_uv >= 0 ? y - 7 : Math.min(PAD.t + PH - 2, y + 14));
      }
    }
  }, [data, channels.join(","), ghost, range[0], range[1], compact]);

  return (
    <canvas
      ref={ref}
      className="w-full block rounded-lg bg-surface-container-lowest"
      style={{ height }}
      role="img"
      aria-label={`Averaged ABR waveform, ${data.trial_count} trials, ${range[0]} to ${range[1]} ms`}
    />
  );
}
