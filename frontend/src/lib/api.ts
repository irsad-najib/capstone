/**
 * Typed API client for the Go backend (neurosound-backend).
 *
 * All functions return typed data or throw on network/HTTP error.
 * Use backendUrl() everywhere so the URL can be overridden from Settings.
 */
import { readSettings } from "@/lib/settings";

export const DEFAULT_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://capstone.irsad.site";

export function backendUrl(): string {
  const override = readSettings().backendUrl.trim();
  return (override || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
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
  stims?: number;        // 0 = terus sampai di-stop
  noise_uv?: number;
  mains_uv?: number;
  no_response?: boolean;
  reset?: boolean;
}

export interface DummyStatus {
  running: boolean;
  options: DummyOptions;
  started_at?: string;
  frames: number;
  stims: number;
  last_error?: string;
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

  /** POST /api/v1/dummy/start — data ABR sintetis dari server */
  dummyStart: (opt: DummyOptions) => post<DummyStatus>("/api/v1/dummy/start", opt, true),

  /** POST /api/v1/dummy/stop */
  dummyStop: () => post<DummyStatus>("/api/v1/dummy/stop", undefined, true),

  /** POST /api/v1/command — perintah konsol ke ESP32 (device kosong = semua) */
  command: (device: string, cmd: string) =>
    post<{ ok: boolean; sent: number }>("/api/v1/command", { device, cmd }, true),

  /** GET /api/v1/logs */
  logs: (limit = 100) =>
    get<{ device: string; lines: LogLine[] }>(`/api/v1/logs?limit=${limit}`, 8000, true),
};
