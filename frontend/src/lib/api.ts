/**
 * Typed API client for the Go backend (neurosound-backend).
 *
 * All functions return typed data or throw on network/HTTP error.
 * Use backendUrl() everywhere; the URL comes from NEXT_PUBLIC_BACKEND_URL.
 */
import { readSettings } from "@/lib/settings";

export const DEFAULT_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://capstone.irsad.site";

export function backendUrl(): string {
  return DEFAULT_BACKEND_URL.replace(/\/+$/, "");
}

// ── Types ──────────────────────────────────────────────────────

export interface HealthResponse {
  status: "ok" | string;
  time: string;
  uptime_s?: number;
  mongo?: boolean;
}

/** Status per device dari /api/v1/devices (field `detail`) */
export interface DeviceDetail {
  id: string;
  connected: boolean;
  connections: number;
  last_seen?: string;
  frames?: number;
  last_frame_at?: string;
  audio_test?: {
    on?: boolean;
    freq?: number;
    level_dbfs?: number;
    ch?: string;
    uptime_ms?: number;
    bat_mv?: number;   // tegangan baterai (mV), tidak ada kalau baterai tidak terdeteksi
    bat_pct?: number;  // 0..100
  };
  audio_test_at?: string;
}

export interface DevicesResponse {
  devices: string[];
  detail?: DeviceDetail[];
}

export interface WaveInfo {
  name: string;
  latency_ms: number;
  amplitude_uv: number;
}

export interface Analysis {
  waves?: WaveInfo[];
  interpeak_ms?: Record<string, number>;
  verdict?: string;
  normal?: boolean;     // Pass + interpeak di rentang normal dewasa
  reasons?: string[];   // alasan kalau normal = false
}

/** Status DSP backend: Noise (<100 trial) → Terbentuk → Konvergen (≥500 & r≥0.9) */
export type ABRStatus = "Noise" | "Terbentuk" | "Konvergen" | string;

/** Real-time ABR result from /api/v1/abr and /api/v1/abr/stream */
export interface ABRResult {
  trial_count: number;
  abr_average: number[][];   // [ch1, ch2], µV
  sampling_rate: number;     // Hz
  epoch_ms: number;          // panjang epoch total
  pre_stim_ms?: number;      // bagian epoch sebelum stimulus
  stim_count?: number;
  frame_count?: number;
  quality: ABRStatus;
  status?: ABRStatus;
  snr: number[];             // dB per channel
  pearson_r?: number;
  analysis?: Analysis;
}

/** Packet from /api/v1/raw/stream */
export interface RawResult {
  samples: number[][];       // [ch1, ch2], µV
  stim: boolean[];
  sampling_rate: number;
  window_ms: number;
}

export interface StimState {
  running: boolean;
  db: number;
  started_at?: string;
  stim_count?: number;
  trials?: number;
}

export type Ear = "left" | "right";

/** Metadata for one saved session */
export interface SessionMeta {
  filename: string;
  saved_at: string; // ISO8601
  trial_count: number;
  status?: ABRStatus;
  snr?: number[];
  verdict?: string;
  device?: string;
  ear?: Ear;
  stim_db?: number;
}

export interface SessionsResponse {
  sessions: SessionMeta[];
  total: number;
}

export interface Snapshot {
  trial_count: number;
  abr_average: number[][];
  pearson_r?: number;
}

/** Full saved session file */
export interface SessionDetail {
  filename?: string;
  saved_at?: string;
  trial_count: number;
  sampling_rate: number;
  epoch_ms: number;
  pre_stim_ms?: number;
  abr_average: number[][];
  abr_snapshots?: Snapshot[] | null;
  snr?: number[];
  pearson_r?: number;
  quality?: ABRStatus;
  status?: ABRStatus;
  analysis?: Analysis;
  device?: string;
  ear?: Ear;
  stim_db?: number;
  note?: string;
}

export interface SaveRequest {
  ear?: Ear;
  device?: string;
  stim_db?: number;
  note?: string;
}

export interface DummyOptions {
  source?: string;       // "synthetic" atau nama file .npz dari /api/v1/dummy/sources
  stims?: number;        // 0 = terus sampai di-stop
  noise_uv?: number;
  mains_uv?: number;
  no_response?: boolean;
  reset?: boolean;
  random_start?: boolean; // rekaman saja: mulai dari sweep acak
  speed?: number;         // kelipatan real-time 1..20
}

export interface DummyWaveTruth {
  latency_ms: number;
  amplitude_uv: number;
}

export interface DummyRecording {
  file: string;
  level_db: number | null;
  fs: number;
  sweeps: number;
  duration_s: number;
  ground_truth?: { waves: Record<string, DummyWaveTruth>; artifact_sweeps: number } | null;
  storage?: "mongodb" | "dir"; // MongoDB GridFS atau folder DUMMY_DIR (cadangan)
}

export interface DummySources {
  sources: string[];
  recordings: DummyRecording[];
  threshold_db?: number | null;
  dir?: string;
  error?: string;
}

export interface DummyStatus {
  running: boolean;
  options: DummyOptions;
  started_at?: string;
  frames: number;
  stims: number;
  last_error?: string;
  recording?: DummyRecording;
  start_sweep?: number;
  speed?: number;
}

export interface LogLine {
  t: string;
  device: string;
  line: string;
}

// ── Helpers ────────────────────────────────────────────────────

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Endpoint admin (dummy, command, logs) butuh LOG_TOKEN kalau backend menyetelnya. */
function authHeaders(): Record<string, string> {
  const token = readSettings().adminToken.trim();
  return token ? { "X-Log-Token": token } : {};
}

async function get<T>(path: string, timeoutMs = 8000, auth = false): Promise<T> {
  const res = await fetch(`${backendUrl()}${path}`, {
    cache: "no-store",
    headers: auth ? authHeaders() : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return parse<T>(res);
}

async function post<T>(path: string, body?: unknown, auth = false): Promise<T> {
  const res = await fetch(`${backendUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? authHeaders() : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  return parse<T>(res);
}

// ── API calls ──────────────────────────────────────────────────

export const api = {
  /** GET /api/v1/health */
  health: () => get<HealthResponse>("/api/v1/health", 4000),

  /** GET /api/v1/devices */
  devices: () => get<DevicesResponse>("/api/v1/devices"),

  /** GET /api/v1/abr — current ABR result */
  abrResult: () => get<ABRResult>("/api/v1/abr"),

  /** GET /api/v1/sessions — list saved sessions (newest first) */
  sessions: () => get<SessionsResponse>("/api/v1/sessions"),

  /** GET /api/v1/sessions/:filename */
  session: (filename: string) =>
    get<SessionDetail>(`/api/v1/sessions/${encodeURIComponent(filename)}`),

  /** POST /api/v1/abr/save */
  saveSession: (meta: SaveRequest) =>
    post<{ ok: boolean; file: string }>("/api/v1/abr/save", meta),

  /** POST /api/v1/reset */
  reset: () => post<{ ok: boolean }>("/api/v1/reset"),

  /** GET /api/v1/stim */
  stim: () => get<StimState>("/api/v1/stim"),

  /** POST /api/v1/stim/start — kirim "on" ke ESP32 */
  stimStart: () => post<StimState & { ok: boolean; sent: number }>("/api/v1/stim/start"),

  /** POST /api/v1/stim/stop — kirim "off" ke ESP32 */
  stimStop: () => post<StimState & { ok: boolean; sent: number }>("/api/v1/stim/stop"),

  /** POST /api/v1/stim/set */
  setDB: (db: number) =>
    post<{ ok: boolean; db: number; sent: number }>("/api/v1/stim/set", { db }),

  // ── Admin (LOG_TOKEN) ──
  /** GET /api/v1/dummy */
  dummy: () => get<DummyStatus>("/api/v1/dummy", 5000, true),

  /** GET /api/v1/dummy/sources — "synthetic" + rekaman .npz di server */
  dummySources: () => get<DummySources>("/api/v1/dummy/sources", 30_000, true),

  /** POST /api/v1/dummy/start — data ABR sintetis / replay rekaman dari server */
  dummyStart: (opt: DummyOptions) => post<DummyStatus>("/api/v1/dummy/start", opt, true),

  /** POST /api/v1/dummy/stop */
  dummyStop: () => post<DummyStatus>("/api/v1/dummy/stop", undefined, true),

  /** POST /api/v1/dummy/speed — kecepatan dummy 1..20× real-time, juga saat berjalan */
  dummySpeed: (speed: number) => post<DummyStatus>("/api/v1/dummy/speed", { speed }, true),

  /** POST /api/v1/command — perintah konsol ke ESP32 (device kosong = semua) */
  command: (device: string, cmd: string) =>
    post<{ ok: boolean; sent: number }>("/api/v1/command", { device, cmd }, true),

  /** GET /api/v1/logs */
  logs: (limit = 100) =>
    get<{ device: string; lines: LogLine[] }>(`/api/v1/logs?limit=${limit}`, 8000, true),
};
