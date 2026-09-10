/**
 * Typed API client for the Go backend.
 *
 * All functions return typed data or throw on network/HTTP error.
 * Import BACKEND_URL from here so there's one place to change it.
 */

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

// ── Types ──────────────────────────────────────────────────────

export interface HealthResponse {
  status: "ok" | string;
  time: string;
}

export interface DevicesResponse {
  devices: string[];
}

/** Real-time ABR result from /api/v1/abr */
export interface ABRResult {
  trial_count: number;
  abr_average: number[][];
  sampling_rate: number;
  epoch_ms: number;
  quality: string;
  snr: number[];
}

/** Metadata for one saved session */
export interface SessionMeta {
  filename: string;
  saved_at: string; // ISO8601
  trial_count: number;
  status?: string;
  snr?: number[];
  verdict?: string;
}

export interface SessionsResponse {
  sessions: SessionMeta[];
  total: number;
}

/** Full saved session file */
export interface SessionDetail {
  filename?: string;
  saved_at?: string;
  trial_count: number;
  sampling_rate: number;
  epoch_ms: number;
  abr_average: number[][];
  abr_snapshots: { trial_count: number; abr_average: number[][] }[];
  snr?: number[];
  pearson_r?: number;
  quality?: string;
  status?: string;
  analysis?: {
    waves?: { name: string; latency_ms: number; amplitude_uv: number }[];
    interpeak_ms?: Record<string, number>;
    verdict?: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    next: { revalidate: 0 }, // always fresh
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── API calls ──────────────────────────────────────────────────

export const api = {
  /** GET /api/v1/health */
  health: () => get<HealthResponse>("/api/v1/health"),

  /** GET /api/v1/devices */
  devices: () => get<DevicesResponse>("/api/v1/devices"),

  /** GET /api/v1/abr — current ABR result */
  abrResult: () => get<ABRResult>("/api/v1/abr"),

  /** GET /api/v1/sessions — list saved sessions */
  sessions: () => get<SessionsResponse>("/api/v1/sessions"),

  /** GET /api/v1/sessions/:filename */
  session: (filename: string) =>
    get<SessionDetail>(`/api/v1/sessions/${encodeURIComponent(filename)}`),

  /** POST /api/v1/abr/save */
  saveSession: () => post<{ ok: boolean; file: string }>("/api/v1/abr/save"),

  /** POST /api/v1/reset */
  reset: () => post<{ ok: boolean }>("/api/v1/reset"),

  /** POST /api/v1/stim/set */
  setDB: (db: number) =>
    post<{ ok: boolean; db: number }>("/api/v1/stim/set", { db }),

  /** POST /api/v1/broadcast */
  broadcast: (msg: string) =>
    post<{ ok: boolean; msg: string }>("/api/v1/broadcast", { msg }),
};
