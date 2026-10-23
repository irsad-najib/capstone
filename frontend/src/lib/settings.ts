"use client";
/**
 * Preferensi aplikasi, disimpan per browser di localStorage.
 * Dipakai lewat useSettings() (reaktif) atau readSettings() (di luar React).
 */
import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  backendUrl:        string;  // kosong = NEXT_PUBLIC_BACKEND_URL / default
  theme:             Theme;
  notifications:     boolean;
  notifyIntervalMin: number;  // jeda minimum antar notifikasi jenis yang sama
  stimDb:            number;  // level stimulus default saat buka /scan
  targetTrials:      number;  // target trial (progress bar + auto-save)
  autoSave:          boolean; // simpan sesi otomatis saat target tercapai
  testLevels:        number[]; // level dB yang dites berurutan (tinggi → rendah)
  stopAtThreshold:   boolean; // berhenti turun level setelah tidak ada respons
  adminToken:        string;  // LOG_TOKEN backend, dipakai halaman /admin
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl:        "",
  theme:             "system",
  notifications:     false,
  notifyIntervalMin: 5,
  stimDb:            80,
  targetTrials:      500,
  autoSave:          false,
  testLevels:        [80, 60, 40],
  stopAtThreshold:   true,
  adminToken:        "",
};

const KEY = "neurosound.settings";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

export function readSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  if (!cache) cache = load();
  return cache;
}

export function writeSettings(patch: Partial<Settings>): void {
  cache = { ...readSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach(l => l());
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

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, readSettings, () => DEFAULT_SETTINGS);
}
