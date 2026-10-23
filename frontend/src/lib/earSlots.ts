"use client";
/**
 * Hasil per telinga untuk satu skrining (kiri + kanan) di halaman /scan.
 * Tiap telinga dites di beberapa level dB; satu hasil per level, urut dari
 * level tertinggi. Ditahan di sini sampai operator menekan "New patient".
 * Disimpan per browser di localStorage, polanya sama dengan lib/settings.
 */
import { useSyncExternalStore } from "react";
import type { Ear } from "@/lib/api";
import type { ABRChartData } from "@/components/ABRWaveformChart";
import type { Outcome } from "@/lib/abr";

export interface EarResult {
  file: string;
  saved_at: string;   // ISO8601
  outcome: Outcome;
  trials: number;
  stim_db: number;
  snr?: number;       // Ch 1, dB
  wave_v_ms?: number;
  chart: ABRChartData; // Ch 1 saja, untuk grafik kecil
}

export type EarSlots = Record<Ear, EarResult[]>;

const EMPTY: EarSlots = { left: [], right: [] };
const KEY = "neurosound.scan.ears";
const listeners = new Set<() => void>();
let cache: EarSlots | null = null;

/** Versi lama menyimpan satu hasil per telinga (objek, bukan array). */
function normalize(v: unknown): EarResult[] {
  if (Array.isArray(v)) return v as EarResult[];
  return v ? [v as EarResult] : [];
}

function read(): EarSlots {
  if (typeof window === "undefined") return EMPTY;
  if (!cache) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(KEY) || "{}");
      cache = { left: normalize(raw.left), right: normalize(raw.right) };
    } catch {
      cache = EMPTY;
    }
  }
  return cache!;
}

function write(next: EarSlots): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach(l => l());
}

/** Tambah hasil satu level; level yang sama diganti. */
export function addEarResult(ear: Ear, result: EarResult): void {
  const cur = read();
  const list = [...cur[ear].filter(r => r.stim_db !== result.stim_db), result].sort((a, b) => b.stim_db - a.stim_db);
  write({ ...cur, [ear]: list });
}

export function clearEar(ear: Ear): void {
  write({ ...read(), [ear]: [] });
}

export function clearEarSlots(): void {
  write(EMPTY);
}

/** Ambang = level terendah yang masih ada respons (Pass). null = belum ada respons. */
export function thresholdOf(results: EarResult[]): number | null {
  const passed = results.filter(r => r.outcome === "Pass").map(r => r.stim_db);
  return passed.length ? Math.min(...passed) : null;
}

/**
 * Selisih latensi wave V kiri–kanan maksimum yang masih normal (ms). Tidak butuh
 * kalibrasi dB: kedua telinga dites dengan alat dan level dB yang sama.
 */
export const INTERAURAL_V_MAX_MS = 0.4;

export interface InterauralRow {
  stim_db: number;
  left: number;   // wave V, ms
  right: number;
  diff: number;   // kiri − kanan, ms
  normal: boolean;
}

/** Wave V kiri vs kanan per level; hanya level yang kedua telinganya Pass. */
export function interauralV(slots: EarSlots): InterauralRow[] {
  const v = (r?: EarResult) => (r?.outcome === "Pass" ? r.wave_v_ms : undefined);
  return slots.left.flatMap(l => {
    const left = v(l), right = v(slots.right.find(r => r.stim_db === l.stim_db));
    if (left == null || right == null) return [];
    const diff = left - right;
    return [{ stim_db: l.stim_db, left, right, diff, normal: Math.abs(diff) <= INTERAURAL_V_MAX_MS }];
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { cache = null; l(); }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useEarSlots(): EarSlots {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
