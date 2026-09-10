"use client";
import { useEffect, useRef } from "react";
import { FS } from "@/hooks/useABRStream";

const WAVE_WIN_MS  = 500;
const WAVE_SAMPLES = Math.round(FS * WAVE_WIN_MS / 1000);

interface Props {
  waveBuf:    Float64Array; // values as-is from backend (µV) or sim (mV)
  stimBuf:    Uint8Array;
  currentMv:  number;
  currentRaw: number;
}

export default function RawWaveformChart({ waveBuf, stimBuf, currentMv, currentRaw }: Props) {
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

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Auto-scale from actual buffer values, floor at 0.01
    let maxAbs = 0.01;
    for (let i = 0; i < WAVE_SAMPLES; i++) {
      const v = Math.abs(waveBuf[i]);
      if (v > maxAbs) maxAbs = v;
    }
    const SCALE = maxAbs * 1.15;
    const mid   = H / 2;

    // ── Background grid ──────────────────────────────────────────────────────
    ctx.strokeStyle = "#e0e3e5";
    ctx.lineWidth = 1;
    for (let row = 0; row <= 4; row++) {
      const y = H * row / 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let col = 0; col <= 10; col++) {
      const x = W * col / 10;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // ── Zero line ────────────────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(118,119,125,0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    ctx.setLineDash([]);

    // ── Stimulus markers ─────────────────────────────────────────────────────
    for (let i = 0; i < WAVE_SAMPLES; i++) {
      if (stimBuf[i] === 1) {
        const x = W * i / WAVE_SAMPLES;
        ctx.save();
        ctx.strokeStyle = "rgba(210,153,34,0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "rgba(210,153,34,0.9)";
        ctx.font = "bold 9px 'Courier New'";
        ctx.textAlign = "left";
        ctx.fillText("S", x + 2, 12);
      }
    }

    // ── Waveform ─────────────────────────────────────────────────────────────
    ctx.strokeStyle = "#3fb950";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < WAVE_SAMPLES; i++) {
      const v = waveBuf[i];
      const x = W * i / WAVE_SAMPLES;
      const y = mid - (v / SCALE) * mid * 0.85;
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    }
    ctx.stroke();

    // ── Y-axis labels (auto unit) ────────────────────────────────────────────
    ctx.fillStyle = "#76777d";
    ctx.font = "10px 'Courier New'";
    ctx.textAlign = "left";
    const fmt = (v: number) => Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
    const unit = Math.abs(SCALE) < 1 ? "mV" : "µV";
    [SCALE, SCALE / 2, 0, -SCALE / 2, -SCALE].forEach((v, i) => {
      const label = v === 0 ? "0" : `${v > 0 ? "+" : ""}${fmt(v)}${unit}`;
      ctx.fillText(label, 4, H * i / 4 + 12);
    });

    // ── Current value badge ──────────────────────────────────────────────────
    const valDisp = `${currentMv >= 0 ? "+" : ""}${currentMv.toFixed(4)}`;
    const badgeW  = 130;
    const badgeH  = 36;
    const bx      = W - badgeW - 8;
    const by      = 8;
    ctx.fillStyle = "rgba(247,249,251,0.92)";
    ctx.strokeStyle = "#c6c6cd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect?.(bx, by, badgeW, badgeH, 5) ?? (() => { ctx.rect(bx, by, badgeW, badgeH); })();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = currentMv >= 0 ? "#3fb950" : "#f85149";
    ctx.font = "bold 12px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText(`${valDisp} ${unit}`, bx + 8, by + 15);
    ctx.fillStyle = "#76777d";
    ctx.font = "10px 'Courier New'";
    ctx.fillText(`raw: ${currentRaw}`, bx + 8, by + 29);

  }, [waveBuf, stimBuf, currentMv, currentRaw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded"
      style={{ height: 200, display: "block", background: "#ffffff" }}
    />
  );
}
