"use client";
import { useCanvas, niceCeil, fmtUv } from "@/hooks/useCanvas";
import type { RawView } from "@/hooks/useABRStream";

interface Props {
  raw:     RawView;
  height?: number;
}

/**
 * Sinyal mentah dua channel (µV) dalam jendela terakhir dari /raw/stream.
 * Tiap channel punya lajur sendiri; garis putus-putus = penanda stimulus.
 */
export default function RawWaveformChart({ raw, height = 260 }: Props) {
  const ref = useCanvas((ctx, W, H, color) => {
    const PAD = { l: 56, r: 10, t: 6, b: 22 };
    const PW = W - PAD.l - PAD.r;
    const lanes = [
      { name: "Ch 1", data: raw.ch1, color: color("secondary") },
      { name: "Ch 2", data: raw.ch2, color: color("primary-container") },
    ];
    const laneH = (H - PAD.t - PAD.b) / lanes.length;
    const n = raw.ch1.length;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";

    if (n === 0) {
      ctx.fillStyle = color("on-surface-variant");
      ctx.font = "13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No samples from the ESP32 yet", W / 2, H / 2);
      return;
    }

    // Sumbu waktu: -window … 0 ms (0 = sampel terbaru)
    const winMs = (n / raw.fs) * 1000;
    ctx.strokeStyle = color("outline-variant");
    ctx.fillStyle = color("on-surface-variant");
    ctx.textAlign = "center";
    const tStep = winMs > 300 ? 100 : 50;
    for (let t = 0; t <= winMs + 1e-6; t += tStep) {
      const x = Math.round(PAD.l + PW * (1 - t / winMs)) + 0.5;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(t === 0 ? "0 ms" : `-${t}`, x, H - 6);
    }

    // Penanda stimulus
    ctx.strokeStyle = color("on-tertiary-container");
    ctx.setLineDash([3, 3]);
    for (let i = 0; i < raw.stim.length; i++) {
      if (!raw.stim[i]) continue;
      const x = Math.round(PAD.l + (PW * i) / n) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
    }
    ctx.setLineDash([]);

    lanes.forEach((lane, k) => {
      const top = PAD.t + k * laneH, mid = top + laneH / 2;
      const d = lane.data;
      // Pusatkan pada rata-rata (offset DC elektroda bisa besar)
      let mean = 0;
      for (let i = 0; i < d.length; i++) mean += d[i];
      mean = d.length ? mean / d.length : 0;
      let maxAbs = 0;
      for (let i = 0; i < d.length; i++) maxAbs = Math.max(maxAbs, Math.abs(d[i] - mean));
      const yMax = niceCeil(Math.max(1, maxAbs * 1.1));
      const yOf = (v: number) => mid - ((v - mean) / yMax) * (laneH / 2 - 4);

      ctx.strokeStyle = color("outline-variant");
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(PAD.l, Math.round(mid) + 0.5); ctx.lineTo(W - PAD.r, Math.round(mid) + 0.5); ctx.stroke();
      if (k > 0) { ctx.beginPath(); ctx.moveTo(0, Math.round(top) + 0.5); ctx.lineTo(W, Math.round(top) + 0.5); ctx.stroke(); }
      ctx.globalAlpha = 1;

      ctx.fillStyle = lane.color;
      ctx.textAlign = "left";
      ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(lane.name, 4, top + 14);
      ctx.fillStyle = color("on-surface-variant");
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(`±${fmtUv(yMax)} µV`, 4, top + 27);

      // Min/max per kolom piksel supaya 8000 sampel tetap terbaca
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      const cols = Math.max(1, Math.floor(PW));
      for (let c = 0; c < cols; c++) {
        const a = Math.floor((c / cols) * d.length), b = Math.max(a + 1, Math.floor(((c + 1) / cols) * d.length));
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i < b && i < d.length; i++) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
        if (lo === Infinity) continue;
        const x = PAD.l + c + 0.5;
        if (c === 0) ctx.moveTo(x, yOf(hi)); else ctx.lineTo(x, yOf(hi));
        ctx.lineTo(x, yOf(lo));
      }
      ctx.stroke();
    });
  }, [raw]);

  return (
    <canvas
      ref={ref}
      className="w-full block rounded-lg bg-surface-container-lowest"
      style={{ height }}
      role="img"
      aria-label="Raw EEG signal, two channels"
    />
  );
}
