"use client";
import { useEffect, useRef } from "react";
import { FS, EPOCH_MS, type ABRResult } from "@/hooks/useABRStream";

const EPOCH_SAMPLES = Math.round(FS * EPOCH_MS / 1000); // 43

interface Props {
  result: ABRResult;
  channel?: number;
}

export default function ABRWaveformChart({ result, channel = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const PAD = { l: 52, r: 14, t: 20, b: 28 };
    const PW = W - PAD.l - PAD.r;
    const PH = H - PAD.t - PAD.b;

    const avg = result.abr_average[channel] ?? new Array(EPOCH_SAMPLES).fill(0);
    const n   = result.trial_count;

    if (n === 0) {
      ctx.fillStyle = "#76777d"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Menunggu sinyal ABR… ESP32 belum terhubung.", W / 2, H / 2);
      return;
    }

    const SCALE = 0.3; // ±0.3 mV
    const mid   = PAD.t + PH / 2;

    // ── Grid ──────────────────────────────────────────────────────────────
    ctx.strokeStyle = "#e0e3e5"; ctx.lineWidth = 1;
    ([-SCALE, -SCALE / 2, 0, SCALE / 2, SCALE]).forEach(v => {
      const y = mid - (v / SCALE) * PH / 2;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.fillStyle = "#76777d"; ctx.font = "10px 'Geist', monospace"; ctx.textAlign = "right";
      ctx.fillText((v > 0 ? "+" : "") + v.toFixed(2) + "mV", PAD.l - 3, y + 4);
    });
    [0, 10, 20, 30, 40, 50].forEach(ms => {
      const x = PAD.l + PW * ms / EPOCH_MS;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
      ctx.fillStyle = "#76777d"; ctx.font = "10px monospace"; ctx.textAlign = "center";
      ctx.fillText(ms + "ms", x, H - PAD.b + 14);
    });

    // ── Noise floor band ──────────────────────────────────────────────────
    let noisePow = 0;
    for (let i = 0; i < 3 && i < avg.length; i++) noisePow += avg[i] ** 2;
    const noiseRMS = Math.sqrt(noisePow / 3);
    ctx.fillStyle = "rgba(118,119,125,0.08)";
    ctx.fillRect(PAD.l, mid - (noiseRMS / SCALE) * PH / 2, PW, (noiseRMS / SCALE) * PH);

    // ── ABR waveform ──────────────────────────────────────────────────────
    const opacity = Math.min(1, 0.4 + n / 200); // fades in as trials accumulate
    ctx.strokeStyle = `rgba(0, 150, 104, ${opacity})`; // tertiary (teal-green)
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < avg.length; i++) {
      const x = PAD.l + PW * i / EPOCH_SAMPLES;
      const y = Math.max(PAD.t, Math.min(PAD.t + PH, mid - (avg[i] / SCALE) * PH / 2));
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    }
    ctx.stroke();

    // ── ABR wave labels (I, III, V) ───────────────────────────────────────
    const waveMs  = [4 / FS * 1000, 12 / FS * 1000, 20 / FS * 1000];
    const waveLabel = ["I", "III", "V"];
    ctx.fillStyle = "rgba(0,150,104,0.75)"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
    waveMs.forEach((ms, wi) => {
      const x = PAD.l + PW * ms / EPOCH_MS;
      if (x < W - PAD.r) {
        ctx.beginPath(); ctx.moveTo(x, PAD.t + 2); ctx.lineTo(x, PAD.t + 8); ctx.stroke();
        ctx.fillText(waveLabel[wi], x, PAD.t + 14);
      }
    });

    // ── Zero line ─────────────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(118,119,125,0.3)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.l, mid); ctx.lineTo(W - PAD.r, mid); ctx.stroke();
    ctx.setLineDash([]);

    // ── Stats badge ───────────────────────────────────────────────────────
    const snr = result.snr[channel] ?? 0;
    ctx.fillStyle = "rgba(247,249,251,0.92)";
    ctx.fillRect(W - PAD.r - 148, PAD.t + 2, 144, 44);
    ctx.strokeStyle = "#c6c6cd"; ctx.lineWidth = 1;
    ctx.strokeRect(W - PAD.r - 148, PAD.t + 2, 144, 44);
    ctx.fillStyle = "#191c1e"; ctx.font = "bold 11px 'Geist', monospace"; ctx.textAlign = "left";
    ctx.fillText(`Trials: ${n.toLocaleString()}`, W - PAD.r - 142, PAD.t + 16);
    ctx.fillStyle = "#00687a";
    ctx.fillText(`SNR: ${snr.toFixed(1)} dB`, W - PAD.r - 142, PAD.t + 30);
    ctx.fillStyle = "#45464d"; ctx.font = "9px sans-serif";
    ctx.fillText(result.quality, W - PAD.r - 142, PAD.t + 42);

  }, [result, channel]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height: 260, display: "block", background: "#f7f9fb" }}
    />
  );
}
