"use client";
/**
 * useABRStream
 * Hook utama halaman scan: koneksi ke backend Go via SSE.
 *
 * Endpoint:
 *   GET /api/v1/health        — cek koneksi (polling 5 s)
 *   GET /api/v1/raw/stream    — SSE: 500 ms sinyal mentah terakhir, tiap 200 ms
 *   GET /api/v1/abr/stream    — SSE: rata-rata ABR + statistik, tiap 2 s
 *
 * Jika backend offline, mode simulasi bisa dinyalakan manual (bentuk data
 * sama dengan backend: µV, 16 kHz, epoch 60 ms dengan 10 ms pre-stimulus).
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { api, backendUrl, type ABRResult, type RawResult } from "@/lib/api";
import { detectWaves } from "@/lib/abr";

export type ConnectionStatus = "connecting" | "live" | "offline" | "simulation";

export interface RawView {
  ch1:      Float64Array;
  ch2:      Float64Array;
  stim:     Uint8Array;
  fs:       number;
  windowMs: number;
}

/** Satu paket SSE raw (bukan frame WebSocket individual). */
export interface PacketLogEntry {
  seq:     number;
  at:      number;   // Date.now()
  samples: number;
  stims:   number;
  ch1:     number;   // sampel terakhir, µV
  ch2:     number;
}

export interface UseABRStreamReturn {
  status:      ConnectionStatus;
  abrResult:   ABRResult;
  prevResult:  ABRResult | null;   // snapshot sebelumnya (ghost trace)
  raw:         RawView;
  packets:     PacketLogEntry[];
  lastPacketAt: number | null;
  paused:      boolean;
  setPaused:   (v: boolean) => void;
  simulation:  boolean;
  setSimulation: (v: boolean) => void;
  /** Kosongkan tampilan lokal (dipanggil setelah POST /reset berhasil). */
  clearLocal:  () => void;
}

const HEALTH_INTERVAL_MS = 5000;
const MAX_PACKETS        = 60;

// ─── Default ──────────────────────────────────────────────────────────────
const FS        = 16000;
const EPOCH_MS  = 60;
const PRE_MS    = 10;
const PRE_N     = (FS * PRE_MS) / 1000;               // 160
const POST_N    = (FS * (EPOCH_MS - PRE_MS)) / 1000;  // 800
const EPOCH_N   = PRE_N + POST_N;                     // 960

function emptyResult(): ABRResult {
  return {
    trial_count:   0,
    abr_average:   [new Array(EPOCH_N).fill(0), new Array(EPOCH_N).fill(0)],
    sampling_rate: FS,
    epoch_ms:      EPOCH_MS,
    pre_stim_ms:   PRE_MS,
    stim_count:    0,
    frame_count:   0,
    quality:       "Noise",
    status:        "Noise",
    snr:           [0, 0],
    pearson_r:     0,
  };
}

function emptyRaw(): RawView {
  return { ch1: new Float64Array(0), ch2: new Float64Array(0), stim: new Uint8Array(0), fs: FS, windowMs: 500 };
}

function rawFromPacket(p: RawResult): RawView {
  return {
    ch1:      Float64Array.from(p.samples?.[0] ?? []),
    ch2:      Float64Array.from(p.samples?.[1] ?? []),
    stim:     Uint8Array.from((p.stim ?? []).map(s => (s ? 1 : 0))),
    fs:       p.sampling_rate || FS,
    windowMs: p.window_ms || 500,
  };
}

// ─── Simulation engine ────────────────────────────────────────────────────
// Meniru pipeline backend: ring buffer → epoch [-10, +50] ms per stimulus →
// baseline correction → running average → SNR(post/pre) → status.
const SIM_RING      = FS * 2;
const SIM_ISI       = Math.round(0.091 * FS);   // 91 ms, sama dengan firmware
const SIM_WAVES     = [[1.6, 0.30], [3.7, 0.25], [5.6, 0.50]] as const; // ms, µV
const SIM_NOISE_UV  = 4;
const SIM_MAINS_UV  = 1.5;

interface SimState {
  ring1:   Float64Array;
  ring2:   Float64Array;
  ringS:   Uint8Array;
  n:       number;        // total sampel dibangkitkan
  nextStim: number;
  pending: number[];
  avg1:    Float64Array;
  avg2:    Float64Array;
  trials:  number;
  stims:   number;
  pearson: number;
  carry:   number;        // sisa sampel pecahan antar frame
}

function initSim(): SimState {
  return {
    ring1: new Float64Array(SIM_RING), ring2: new Float64Array(SIM_RING), ringS: new Uint8Array(SIM_RING),
    n: 0, nextStim: PRE_N + 10, pending: [],
    avg1: new Float64Array(EPOCH_N), avg2: new Float64Array(EPOCH_N),
    trials: 0, stims: 0, pearson: 0, carry: 0,
  };
}

function gauss(): number {
  // Box–Muller
  return Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random());
}

function abrTemplate(tMs: number): number {
  let v = 0;
  for (const [lat, amp] of SIM_WAVES) v += amp * Math.exp(-0.5 * ((tMs - lat) / 0.25) ** 2);
  return v;
}

function pearson(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function snrDb(avg: Float64Array): number {
  let pre = 0, post = 0;
  for (let i = 0; i < PRE_N; i++) pre += avg[i] ** 2;
  for (let i = PRE_N; i < EPOCH_N; i++) post += avg[i] ** 2;
  const rPre = Math.sqrt(pre / PRE_N), rPost = Math.sqrt(post / POST_N);
  return 20 * Math.log10((rPost + 1e-9) / (rPre + 1e-9));
}

function simTick(s: SimState, dtMs: number): void {
  const want = (FS * Math.min(dtMs, 250)) / 1000 + s.carry;
  const count = Math.floor(want);
  s.carry = want - count;
  for (let k = 0; k < count; k++) {
    const i = s.n;
    const isStim = i === s.nextStim;
    if (isStim) {
      s.nextStim += SIM_ISI;
      s.stims++;
      s.pending.push(i);
    }
    // Sampel ke-i berisi respons dari stimulus terakhir (jika masih dalam 50 ms).
    const lastStim = s.nextStim - SIM_ISI;
    const age = ((i - lastStim) / FS) * 1000;
    const resp = lastStim >= 0 && age >= 0 && age < 50 ? abrTemplate(age) : 0;
    const t = i / FS;
    const mains = SIM_MAINS_UV * Math.sin(2 * Math.PI * 50 * t);
    const idx = i % SIM_RING;
    s.ring1[idx] = SIM_NOISE_UV * gauss() + mains + resp;
    s.ring2[idx] = SIM_NOISE_UV * gauss() + mains + 0.4 * resp;
    s.ringS[idx] = isStim ? 1 : 0;
    s.n++;

    // Epoch lengkap → update rata-rata
    if (s.pending.length && s.n - s.pending[0] >= POST_N) {
      const st = s.pending.shift()!;
      const start = st - PRE_N;
      if (start < 0) continue;
      const e1 = new Float64Array(EPOCH_N), e2 = new Float64Array(EPOCH_N);
      let b1 = 0, b2 = 0;
      const baseN = FS / 1000;
      for (let j = 0; j < EPOCH_N; j++) {
        const r = (start + j) % SIM_RING;
        e1[j] = s.ring1[r]; e2[j] = s.ring2[r];
        if (j < baseN) { b1 += e1[j]; b2 += e2[j]; }
      }
      b1 /= baseN; b2 /= baseN;
      const prev = s.avg1.slice();
      s.trials++;
      const n = s.trials;
      for (let j = 0; j < EPOCH_N; j++) {
        s.avg1[j] = ((n - 1) * s.avg1[j] + (e1[j] - b1)) / n;
        s.avg2[j] = ((n - 1) * s.avg2[j] + (e2[j] - b2)) / n;
      }
      s.pearson = n > 1 ? pearson(prev, s.avg1) : 0;
    }
  }
}

function simResult(s: SimState): ABRResult {
  const status = s.trials < 100 ? "Noise" : s.trials >= 500 && s.pearson >= 0.9 ? "Konvergen" : "Terbentuk";
  const avg1 = Array.from(s.avg1), avg2 = Array.from(s.avg2);
  const snr = [Math.round(snrDb(s.avg1) * 10) / 10, Math.round(snrDb(s.avg2) * 10) / 10];
  const analysis = s.trials ? detectWaves(avg1, FS, PRE_MS) : { waves: [], interpeak_ms: {} };
  const verdict = status === "Konvergen" && snr[0] >= 3 && (analysis.waves?.length ?? 0) >= 3 ? "Pass" : "Refer";
  return {
    trial_count: s.trials, abr_average: [avg1, avg2], sampling_rate: FS, epoch_ms: EPOCH_MS,
    pre_stim_ms: PRE_MS, stim_count: s.stims, frame_count: s.n,
    quality: status, status, snr, pearson_r: s.pearson,
    analysis: { ...analysis, verdict },
  };
}

function simRaw(s: SimState, windowMs = 500): RawView {
  const n = Math.min(s.n, Math.round((FS * windowMs) / 1000));
  const ch1 = new Float64Array(n), ch2 = new Float64Array(n), stim = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const r = (s.n - n + k) % SIM_RING;
    ch1[k] = s.ring1[r]; ch2[k] = s.ring2[r]; stim[k] = s.ringS[r];
  }
  return { ch1, ch2, stim, fs: FS, windowMs };
}

// ─── Hook ─────────────────────────────────────────────────────────────────
export function useABRStream(): UseABRStreamReturn {
  const [status,       setStatus]     = useState<ConnectionStatus>("connecting");
  const [abrResult,    setAbrResult]  = useState<ABRResult>(emptyResult);
  const [prevResult,   setPrevResult] = useState<ABRResult | null>(null);
  const [raw,          setRaw]        = useState<RawView>(emptyRaw);
  const [packets,      setPackets]    = useState<PacketLogEntry[]>([]);
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null);
  const [paused,       setPausedState] = useState(false);
  const [simulation,   setSimulationState] = useState(false);

  const statusRef  = useRef<ConnectionStatus>("connecting");
  const pausedRef  = useRef(false);
  const simRef     = useRef<SimState | null>(null);
  const seqRef     = useRef(0);
  const rawSseRef  = useRef<EventSource | null>(null);
  const abrSseRef  = useRef<EventSource | null>(null);
  const lastAbrRef = useRef<ABRResult | null>(null);

  const changeStatus = useCallback((s: ConnectionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const applyResult = useCallback((r: ABRResult) => {
    const last = lastAbrRef.current;
    if (last && last.trial_count !== r.trial_count && last.trial_count > 0) setPrevResult(last);
    if (r.trial_count === 0) setPrevResult(null);
    lastAbrRef.current = r;
    setAbrResult(r);
  }, []);

  const pushPacket = useCallback((v: RawView) => {
    const n = v.ch1.length;
    let stims = 0;
    for (let i = 0; i < v.stim.length; i++) stims += v.stim[i];
    const entry: PacketLogEntry = {
      seq: ++seqRef.current, at: Date.now(), samples: n, stims,
      ch1: n ? v.ch1[n - 1] : 0, ch2: v.ch2.length ? v.ch2[v.ch2.length - 1] : 0,
    };
    setPackets(prev => {
      const next = prev.length >= MAX_PACKETS ? prev.slice(prev.length - MAX_PACKETS + 1) : prev.slice();
      next.push(entry);
      return next;
    });
    setLastPacketAt(entry.at);
  }, []);

  const stopSSE = useCallback(() => {
    rawSseRef.current?.close(); rawSseRef.current = null;
    abrSseRef.current?.close(); abrSseRef.current = null;
  }, []);

  const startSSE = useCallback(() => {
    stopSSE();
    const base = backendUrl();

    const rawSse = new EventSource(`${base}/api/v1/raw/stream`);
    rawSse.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const v = rawFromPacket(JSON.parse(e.data) as RawResult);
        setRaw(v);
        pushPacket(v);
      } catch {}
    };
    const abrSse = new EventSource(`${base}/api/v1/abr/stream`);
    abrSse.onmessage = (e) => {
      if (pausedRef.current) return;
      try { applyResult(JSON.parse(e.data) as ABRResult); } catch {}
    };
    // EventSource mencoba reconnect sendiri; kalau backend benar-benar mati,
    // health check yang menurunkan status ke offline.
    const onError = () => {
      if (rawSse.readyState === EventSource.CLOSED || abrSse.readyState === EventSource.CLOSED) {
        stopSSE();
        if (statusRef.current === "live") changeStatus("offline");
      }
    };
    rawSse.onerror = onError;
    abrSse.onerror = onError;
    rawSseRef.current = rawSse;
    abrSseRef.current = abrSse;

    // Hasil terakhir langsung, tanpa menunggu tick SSE 2 s
    api.abrResult().then(applyResult).catch(() => {});
  }, [stopSSE, pushPacket, applyResult, changeStatus]);

  // ── Health polling ────────────────────────────────────────────────────
  useEffect(() => {
    if (simulation) return;
    let mounted = true;
    const check = async () => {
      try {
        await api.health();
        if (!mounted) return;
        if (statusRef.current !== "live" || !rawSseRef.current) {
          changeStatus("live");
          startSSE();
        }
      } catch {
        if (!mounted) return;
        stopSSE();
        changeStatus("offline");
      }
    };
    check();
    const id = setInterval(check, HEALTH_INTERVAL_MS);
    return () => { mounted = false; clearInterval(id); stopSSE(); };
  }, [simulation, startSSE, stopSSE, changeStatus]);

  // ── Simulation loop ───────────────────────────────────────────────────
  useEffect(() => {
    if (!simulation) return;
    simRef.current ??= initSim();
    let raf = 0;
    let last = performance.now();
    let lastEmit = 0;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current && simRef.current) {
        simTick(simRef.current, dt);
        if (now - lastEmit >= 200) {
          lastEmit = now;
          const v = simRaw(simRef.current);
          setRaw(v);
          pushPacket(v);
          applyResult(simResult(simRef.current));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [simulation, pushPacket, applyResult]);

  const clearLocal = useCallback(() => {
    if (simRef.current) simRef.current = initSim();
    lastAbrRef.current = null;
    setPrevResult(null);
    setAbrResult(emptyResult());
    setRaw(emptyRaw());
    setPackets([]);
    seqRef.current = 0;
  }, []);

  const setPaused = useCallback((v: boolean) => {
    pausedRef.current = v;
    setPausedState(v);
  }, []);

  const setSimulation = useCallback((v: boolean) => {
    stopSSE();
    simRef.current = v ? initSim() : null;
    lastAbrRef.current = null;
    setPrevResult(null);
    setAbrResult(emptyResult());
    setRaw(emptyRaw());
    setPackets([]);
    setSimulationState(v);
    changeStatus(v ? "simulation" : "connecting");
  }, [stopSSE, changeStatus]);

  return {
    status, abrResult, prevResult, raw, packets, lastPacketAt,
    paused, setPaused, simulation, setSimulation, clearLocal,
  };
}
