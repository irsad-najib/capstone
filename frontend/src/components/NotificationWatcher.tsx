"use client";
/**
 * Notifikasi browser (Settings → Notifications): scan konvergen,
 * backend offline, device terputus. Aktif di semua halaman.
 */
import { useEffect } from "react";
import { api } from "@/lib/api";
import { readSettings, useSettings } from "@/lib/settings";

const POLL_MS = 10_000;
type Kind = "converged" | "offline" | "disconnect";

export default function NotificationWatcher() {
  const { notifications } = useSettings();

  useEffect(() => {
    if (!notifications || typeof Notification === "undefined") return;
    const lastSent: Partial<Record<Kind, number>> = {};
    let online: boolean | null = null;
    let devices: Set<string> | null = null;
    let converged: boolean | null = null;

    const notify = (kind: Kind, title: string, body: string) => {
      const gap = readSettings().notifyIntervalMin * 60_000;
      const now = Date.now();
      if (Notification.permission !== "granted" || now - (lastSent[kind] ?? 0) < gap) return;
      lastSent[kind] = now;
      new Notification(title, { body, tag: `neurosound-${kind}` });
    };

    const tick = async () => {
      try {
        await api.health();
        online = true;
      } catch {
        if (online !== false) notify("offline", "Backend offline", "NeuroSound backend is not responding.");
        online = false;
        return;
      }
      try {
        const d = await api.devices();
        const now = new Set(d.devices);
        if (devices) for (const id of devices) if (!now.has(id)) notify("disconnect", "Device disconnected", `${id} lost its connection.`);
        devices = now;
      } catch {}
      try {
        const r = await api.abrResult();
        const isConv = r.status === "Konvergen";
        if (converged === false && isConv) notify("converged", "Scan converged", `${r.trial_count} trials averaged — the result is ready to save.`);
        converged = isConv;
      } catch {}
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [notifications]);

  return null;
}
