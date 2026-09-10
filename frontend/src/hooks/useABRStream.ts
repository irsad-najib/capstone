"use client";
/**
 * useABRStream
 * Hook utama yang menghubungkan ke backend Go via SSE.
 * Jika backend offline → otomatis fallback ke mode simulasi.
 *
 * Endpoint yang digunakan:
 *   GET /api/v1/health        — cek koneksi (polling 5s)
 *   GET /api/v1/raw/stream    — SSE: raw ADC samples (200ms interval)
 *   GET /api/v1/abr/stream    — SSE: ABR average + stats (2s interval)
 *   GET /api/v1/devices       — daftar perangkat terhubung
 */
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants (sama dengan firmware ADS1115) ─────────────────────────────
export const FS          = 860;       // ADS1115 @ 860 SPS
export const EPOCH_MS    = 50;        // epoch window
const EPOCH_SAMPLES      = Math.round(FS * EPOCH_MS / 1000); // 43
const WAVE_WIN_MS        = 500;
const WAVE_SAMPLES       = Math.round(FS * WAVE_WIN_MS / 1000); // 430
const STIM_INTERVAL_MS   = 91;        // ~11 klik/dtk (firmware: STIM_INTERVAL_MS)
const BACKEND_URL        = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";
const HEALTH_INTERVAL_MS = 5000;

// ─── Types ────────────────────────────────────────────────────────────────
export type ConnectionStatus = "connecting" | "live" | "simulation";

export interface WaveInfo {
  name:       string;
  latency_ms: number;
  amplitude:  number;
}

export interface ABRAnalysis {
  waves:        WaveInfo[];
  interpeak_ms: Record<string, number>;
  verdict:      string;
}

export interface ABRResult {
  trial_count:   number;
  abr_average:   number[][];
  sampling_rate: number;
  epoch_ms:      number;
  quality:       string;
  snr:           number[];
  analysis?:     ABRAnalysis;
}

export interface FrameLogEntry {
  idx:  number;
  ts:   number;
  mv:   number;
  raw:  number;
  stim: boolean;
}

export interface UseABRStreamReturn {
  status:        ConnectionStatus;
  devices:       string[];
  rawWave:       Float64Array;
  rawStim:       Uint8Array;
  abrResult:     ABRResult;
  stimCount:     number;
  frameCount:    number;
  currentMv:     number;
  currentRaw:    number;
  recentFrames:  FrameLogEntry[];
  paused:        boolean;
  setPaused:     (v: boolean) => void;
  resetABR:      () => void;
}

// ─── Default ABR result ───────────────────────────────────────────────────
function makeDefaultABR(): ABRResult {
  return {
    trial_count:   0,
    abr_average:   Array.from({ length: 8 }, () => new Array(EPOCH_SAMPLES).fill(0)),
    sampling_rate: FS,
    epoch_ms:      EPOCH_MS,
    quality:       "Noise",
    snr:           new Array(8).fill(0),
  };
}

// ─── Simulation engine ────────────────────────────────────────────────────
interface SimState {
  noise:      number;
  t:          number;
  lastStim:   number;
  simMs:      number;
  lastStimMs: number;
  stimCount:  number;
  trialCount: number;
  abrAvg:     Float64Array;
  epochBuf:   number[];
  inEpoch:    boolean;
  waveBuf:    Float64Array;
  waveStim:   Uint8Array;
  waveHead:   number;
  frameCount: number;
}

function initSim(): SimState {
  return {
    noise: 0, t: 0, lastStim: -9999,
    simMs: 0, lastStimMs: 0,
    stimCount: 0, trialCount: 0,
    abrAvg:    new Float64Array(EPOCH_SAMPLES),
    epochBuf:  [],
    inEpoch:   false,
    waveBuf:   new Float64Array(WAVE_SAMPLES),
    waveStim:  new Uint8Array(WAVE_SAMPLES),
    waveHead:  0,
    frameCount: 0,
  };
}

const ABR_WAVES = [
  { d: 4,  a: 0.18, w: 1.8 },  // Wave I
  { d: 12, a: 0.12, w: 2.5 },  // Wave III
  { d: 20, a: 0.28, w: 3.5 },  // Wave V
  { d: 28, a: 0.08, w: 2.5 },  // Wave VI
];

function simGenSample(s: SimState, isStim: boolean): number {
  s.noise += (Math.random() - 0.5) * 0.035;
  s.noise *= 0.988;
  const plf   = Math.sin(2 * Math.PI * 50 * s.t / FS) * 0.012;
  const alpha  = Math.sin(2 * Math.PI * 10 * s.t / FS) * 0.06
                * Math.max(0, Math.sin(2 * Math.PI * 0.4 * s.t / FS));
  if (isStim) s.lastStim = s.t;
  const age = s.t - s.lastStim;
  const pol = s.stimCount % 2 === 0 ? 1 : -1;
  let abr = 0;
  if (age >= 0 && age < 60) {
    for (const w of ABR_WAVES) {
      const dt = age - w.d;
      abr += pol * w.a * Math.exp(-dt * dt / (2 * w.w * w.w));
    }
  }
  s.t++;
  return (s.noise + plf + alpha + abr) * (4096 / 32768) * 1000; // mV
}

function simTick(s: SimState, dtMs: number): void {
  const n = Math.round(FS / 1000 * dtMs);
  for (let i = 0; i < n; i++) {
    s.simMs += 1000 / FS;
    const isStim = (s.simMs - s.lastStimMs) >= STIM_INTERVAL_MS;
    if (isStim) {
      s.lastStimMs = s.simMs;
      s.stimCount++;
      s.inEpoch = true;
      s.epochBuf = [];
    }
    const mv = simGenSample(s, isStim);
    s.waveBuf[s.waveHead] = mv;
    s.waveStim[s.waveHead] = isStim ? 1 : 0;
    s.waveHead = (s.waveHead + 1) % WAVE_SAMPLES;
    if (s.inEpoch) {
      s.epochBuf.push(mv);
      if (s.epochBuf.length >= EPOCH_SAMPLES) {
        s.inEpoch = false;
        s.trialCount++;
        const n = s.trialCount;
        for (let j = 0; j < EPOCH_SAMPLES; j++) {
          s.abrAvg[j] = (s.abrAvg[j] * (n - 1) + s.epochBuf[j]) / n;
        }
      }
    }
    s.frameCount++;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────
export function useABRStream(): UseABRStreamReturn {
  const [status,       setStatus]       = useState<ConnectionStatus>("connecting");
  const [devices,      setDevices]      = useState<string[]>([]);
  const [abrResult,    setAbrResult]    = useState<ABRResult>(makeDefaultABR());
  const [stimCount,    setStimCount]    = useState(0);
  const [frameCount,   setFrameCount]   = useState(0);
  const [currentMv,    setCurrentMv]    = useState(0);
  const [currentRaw,   setCurrentRaw]   = useState(0);
  const [recentFrames, setRecentFrames] = useState<FrameLogEntry[]>([]);
  const [paused,       setPaused]       = useState(false);
  const pausedRef = useRef(false);

  const frameLogRef = useRef<FrameLogEntry[]>([]);
  const MAX_LOG = 80;

  function handleSetPaused(v: boolean) {
    pausedRef.current = v;
    setPaused(v);
  }

  function resetABR() {
    // Reset backend state
    fetch(`${BACKEND_URL}/api/v1/reset`, { method: "POST" }).catch(() => {});

    // Reset local sim state
    const s = simRef.current;
    s.trialCount = 0;
    s.stimCount  = 0;
    s.frameCount = 0;
    s.abrAvg     = new Float64Array(EPOCH_SAMPLES);
    s.epochBuf   = [];
    s.inEpoch    = false;
    s.waveBuf.fill(0);
    s.waveStim.fill(0);
    s.waveHead = 0;
    rawWaveRef.current = new Float64Array(WAVE_SAMPLES);
    rawStimRef.current = new Uint8Array(WAVE_SAMPLES);
    frameLogRef.current = [];
    setRecentFrames([]);
    setAbrResult(makeDefaultABR());
    setStimCount(0);
    setFrameCount(0);
  }

  function pushFrameLog(entry: FrameLogEntry) {
    const next = [...frameLogRef.current, entry];
    if (next.length > MAX_LOG) next.splice(0, next.length - MAX_LOG);
    frameLogRef.current = next;
  }

  // Ring buffers — kept in refs (no re-render on every sample)
  const rawWaveRef  = useRef(new Float64Array(WAVE_SAMPLES));
  const rawStimRef  = useRef(new Uint8Array(WAVE_SAMPLES));
  const [, forceRedraw] = useState(0);

  const simRef      = useRef<SimState>(initSim());
  const rafRef      = useRef<number>(0);
  const lastTickRef = useRef(performance.now());

  // ── Backend health check ────────────────────────────────────────────────
  const rawSseRef = useRef<EventSource | null>(null);
  const abrSseRef = useRef<EventSource | null>(null);

  const stopSSE = useCallback(() => {
    rawSseRef.current?.close(); rawSseRef.current = null;
    abrSseRef.current?.close(); abrSseRef.current = null;
  }, []);

  const startSSE = useCallback(() => {
    stopSSE();

    // Raw stream
    const rawSse = new EventSource(`${BACKEND_URL}/api/v1/raw/stream`);
    rawSse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { samples: number[][]; sampling_rate: number };
        if (!data.samples?.[0]?.length) return;
        const arr       = data.samples[0];
        const stimArr   = (data as { samples: number[][], stim?: boolean[], sampling_rate: number }).stim ?? [];
        const startFrom = Math.max(0, arr.length - WAVE_SAMPLES);
        const newBuf    = new Float64Array(WAVE_SAMPLES);
        const newStim   = new Uint8Array(WAVE_SAMPLES);
        for (let i = startFrom; i < arr.length; i++) {
          const j = i - startFrom;
          newBuf[j]  = arr[i];
          newStim[j] = stimArr[i] ? 1 : 0;
        }
        rawWaveRef.current = newBuf;
        rawStimRef.current = newStim;
        if (arr.length > 0) {
          const lastVal = arr[arr.length - 1];
          const lastStim = stimArr.length > 0 ? stimArr[stimArr.length - 1] : false;
          setCurrentMv(lastVal);
          setCurrentRaw(arr.length);
          pushFrameLog({ idx: frameLogRef.current.length + 1, ts: Date.now(), mv: lastVal, raw: arr.length, stim: lastStim });
          setRecentFrames([...frameLogRef.current]);
        }
        forceRedraw(v => v + 1);
      } catch {}
    };
    rawSse.onerror = () => {
      setStatus("simulation");
      stopSSE();
    };
    rawSseRef.current = rawSse;

    // ABR stream
    const abrSse = new EventSource(`${BACKEND_URL}/api/v1/abr/stream`);
    abrSse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as ABRResult;
        setAbrResult(data);
        setStimCount(prev => prev + 1); // approximate
      } catch {}
    };
    abrSse.onerror = () => {
      setStatus("simulation");
      stopSSE();
    };
    abrSseRef.current = abrSse;
  }, [stopSSE]);

  // ── Health polling ────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const checkHealth = async () => {
      if (!mounted) return;
      try {
        const r = await fetch(`${BACKEND_URL}/api/v1/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!r.ok) throw new Error("not ok");
        if (!mounted) return;

        // Backend is up
        if (status !== "live") {
          setStatus("live");
          startSSE();
          // fetch devices
          fetch(`${BACKEND_URL}/api/v1/devices`)
            .then(r => r.json())
            .then((d: { devices: string[] }) => mounted && setDevices(d.devices))
            .catch(() => {});
        }
      } catch {
        if (!mounted) return;
        if (status === "live") {
          setStatus("simulation");
          stopSSE();
        } else {
          setStatus("simulation");
        }
      }
    };

    checkHealth();
    const id = setInterval(checkHealth, HEALTH_INTERVAL_MS);
    return () => { mounted = false; clearInterval(id); stopSSE(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Simulation RAF loop ────────────────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      if (status !== "simulation" || pausedRef.current) {
        lastTickRef.current = performance.now();
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const now = performance.now();
      const dt  = now - lastTickRef.current;
      lastTickRef.current = now;
      const s   = simRef.current;
      simTick(s, dt);

      // Copy sim buffers to shared refs, reordered from waveHead so index 0 = oldest
      const reordered     = new Float64Array(WAVE_SAMPLES);
      const reorderedStim = new Uint8Array(WAVE_SAMPLES);
      for (let i = 0; i < WAVE_SAMPLES; i++) {
        const src = (s.waveHead + i) % WAVE_SAMPLES;
        reordered[i]     = s.waveBuf[src];
        reorderedStim[i] = s.waveStim[src];
      }
      rawWaveRef.current  = reordered;
      rawStimRef.current  = reorderedStim;

      // Build ABR result from sim
      const abrAvgCh0 = Array.from(s.abrAvg);
      let sigPeak = 0;
      for (let i = 3; i < Math.min(28, EPOCH_SAMPLES); i++) {
        sigPeak = Math.max(sigPeak, Math.abs(s.abrAvg[i]));
      }
      let noiseSum = 0;
      for (let i = 0; i < 3 && i < EPOCH_SAMPLES; i++) noiseSum += s.abrAvg[i] ** 2;
      const noiseRMS = Math.sqrt(noiseSum / 3);
      const snr = noiseRMS > 1e-10 ? 20 * Math.log10(sigPeak / noiseRMS) : -20;
      const quality = s.trialCount >= 500 ? "Konvergen"
                    : s.trialCount >= 100 ? "Mulai Terbentuk"
                    : "Noise";

      // Push throttled frame log entries (1 per ~29 frames + every stim)
      const lastIdx = (s.waveHead - 1 + WAVE_SAMPLES) % WAVE_SAMPLES;
      const lastStim = s.waveStim[lastIdx] === 1;
      const logEvery = Math.max(1, Math.round(FS / 30));
      if (s.frameCount % logEvery === 0 || lastStim) {
        const mv  = s.waveBuf[lastIdx];
        const raw = Math.round(mv / 0.125);
        pushFrameLog({ idx: s.frameCount, ts: s.frameCount, mv, raw, stim: lastStim });
      }

      if (s.frameCount % 30 === 0) { // update state ~30fps
        setAbrResult({
          trial_count:   s.trialCount,
          abr_average:   [abrAvgCh0, ...Array.from({ length: 7 }, () => new Array(EPOCH_SAMPLES).fill(0))],
          sampling_rate: FS,
          epoch_ms:      EPOCH_MS,
          quality,
          snr:           [Math.round(snr * 10) / 10, ...new Array(7).fill(0)],
        });
        setStimCount(s.stimCount);
        setFrameCount(s.frameCount);
        setCurrentMv(s.waveBuf[lastIdx]);
        setCurrentRaw(Math.round(s.waveBuf[lastIdx] / 0.125));
        setRecentFrames([...frameLogRef.current]);
        forceRedraw(v => v + 1);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status]);

  return {
    status,
    devices,
    rawWave:      rawWaveRef.current,
    rawStim:      rawStimRef.current,
    abrResult,
    stimCount,
    frameCount,
    currentMv,
    currentRaw,
    recentFrames,
    paused,
    setPaused:    handleSetPaused,
    resetABR,
  };
}
