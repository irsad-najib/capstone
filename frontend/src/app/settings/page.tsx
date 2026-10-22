"use client";

import { useState } from "react";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import { Card, Footer } from "@/components/ui";
import { DEFAULT_BACKEND_URL, type HealthResponse } from "@/lib/api";
import { MIN_TRIALS } from "@/lib/abr";
import { DEFAULT_SETTINGS, useSettings, writeSettings, type Theme } from "@/lib/settings";
import { MdCloud, MdDarkMode, MdLightMode, MdNotificationsActive, MdPalette, MdSettingsBrightness, MdTune } from "react-icons/md";

const INTERVALS = [1, 5, 15, 30, 60];
const DB_LEVELS = [40, 50, 60, 70, 80, 90];

export default function SettingsPage() {
  const s = useSettings();
  const [url, setUrl] = useState<string | null>(null); // null = belum diedit
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

  const urlValue = url ?? s.backendUrl;

  async function testConnection() {
    const base = (urlValue.trim() || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
    setTesting(true);
    setTest(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`${base}/api/v1/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const h = (await res.json()) as HealthResponse;
      setTest({ ok: h.status === "ok", text: `${base} → ${h.status} in ${Math.round(performance.now() - t0)} ms${h.mongo != null ? `, MongoDB ${h.mongo ? "on" : "off"}` : ""}` });
    } catch (e) {
      setTest({ ok: false, text: `${base} → ${e instanceof Error ? e.message : e}` });
    } finally {
      setTesting(false);
    }
  }

  function saveUrl() {
    writeSettings({ backendUrl: urlValue.trim().replace(/\/+$/, "") });
    setUrl(null);
  }

  async function toggleNotifications(on: boolean) {
    setNotifyMsg(null);
    if (!on) { writeSettings({ notifications: false }); return; }
    if (typeof Notification === "undefined") { setNotifyMsg("This browser does not support notifications."); return; }
    const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (perm !== "granted") { setNotifyMsg("Notification permission was denied in the browser settings."); return; }
    writeSettings({ notifications: true });
  }

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div>
              <h1 className="text-lg font-bold text-primary">Settings</h1>
              <p className="text-[11px] text-on-surface-variant">Saved automatically in this browser</p>
            </div>
          </>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-5xl mx-auto space-y-6">
        <Card title="Backend" icon={<MdCloud className="text-secondary" />}>
          <div className="space-y-3">
            <label className="block text-sm font-semibold" htmlFor="backend-url">Backend URL</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="backend-url"
                value={urlValue}
                onChange={e => setUrl(e.target.value)}
                placeholder={DEFAULT_BACKEND_URL}
                className="flex-1 min-h-10 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                spellCheck={false}
              />
              <button onClick={testConnection} disabled={testing} className="min-h-10 px-4 rounded-lg border border-outline-variant text-xs font-bold text-primary hover:bg-surface-container-low disabled:opacity-50">
                {testing ? "Testing…" : "Test connection"}
              </button>
              <button onClick={saveUrl} disabled={url === null} className="min-h-10 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold disabled:opacity-40">
                Save
              </button>
            </div>
            <p className="text-xs text-on-surface-variant">Leave empty to use the default <span className="font-mono">{DEFAULT_BACKEND_URL}</span>.</p>
            {test && (
              <p role="status" className={`text-xs font-mono rounded-lg px-3 py-2 ${test.ok ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"}`}>
                {test.ok ? "✓" : "✕"} {test.text}
              </p>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card title="Scan defaults" icon={<MdTune className="text-secondary" />}>
            <div className="space-y-5">
              <Field label="Stimulus level" hint="Level shown when the scan page opens and nothing is running.">
                <Segmented options={DB_LEVELS.map(v => ({ value: v, label: `${v}` }))} value={s.stimDb} onChange={v => writeSettings({ stimDb: v })} suffix="dB" />
              </Field>
              <Field label="Target trials" hint={`Progress bar target and auto-save point. Backend needs ≥500 trials to converge (minimum ${MIN_TRIALS}).`}>
                <input
                  type="number" min={MIN_TRIALS} max={5000} step={50}
                  value={s.targetTrials}
                  onChange={e => writeSettings({ targetTrials: Math.max(MIN_TRIALS, Math.min(5000, Number(e.target.value) || DEFAULT_SETTINGS.targetTrials)) })}
                  className="w-32 min-h-10 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </Field>
              <Toggle
                label="Auto-save when target is reached"
                hint="Saves the session once and opens the result page."
                checked={s.autoSave}
                onChange={v => writeSettings({ autoSave: v })}
              />
            </div>
          </Card>

          <div className="space-y-6">
            <Card title="Notifications" icon={<MdNotificationsActive className="text-secondary" />}>
              <div className="space-y-5">
                <Toggle
                  label="Enable notifications"
                  hint="Alert when a scan converges, the backend goes offline, or a device disconnects."
                  checked={s.notifications}
                  onChange={toggleNotifications}
                />
                {notifyMsg && <p role="alert" className="text-xs text-error">{notifyMsg}</p>}
                <Field label="Repeat interval" hint="Minimum time between two alerts of the same kind.">
                  <Segmented options={INTERVALS.map(v => ({ value: v, label: `${v}` }))} value={s.notifyIntervalMin} onChange={v => writeSettings({ notifyIntervalMin: v })} suffix="min" disabled={!s.notifications} />
                </Field>
              </div>
            </Card>

            <Card title="Appearance" icon={<MdPalette className="text-secondary" />}>
              <Field label="Theme">
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Theme">
                  {([
                    { value: "system", label: "System", icon: MdSettingsBrightness },
                    { value: "light",  label: "Light",  icon: MdLightMode },
                    { value: "dark",   label: "Dark",   icon: MdDarkMode },
                  ] as { value: Theme; label: string; icon: typeof MdLightMode }[]).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => writeSettings({ theme: value })}
                      aria-pressed={s.theme === value}
                      className={`min-h-14 rounded-lg border flex flex-col items-center justify-center gap-1 text-xs font-bold ${
                        s.theme === value ? "bg-primary text-on-primary border-primary" : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container-low"
                      }`}
                    >
                      <Icon className="text-lg" />{label}
                    </button>
                  ))}
                </div>
              </Field>
            </Card>
          </div>
        </div>

        <button onClick={() => { writeSettings(DEFAULT_SETTINGS); setUrl(null); setTest(null); }} className="text-xs font-bold text-on-surface-variant hover:text-error">
          Reset all settings to defaults
        </button>

        <Footer />
      </main>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label}</p>
      {children}
      {hint && <p className="text-xs text-on-surface-variant">{hint}</p>}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-xs text-on-surface-variant mt-0.5">{hint}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-secondary" : "bg-outline-variant"}`}
      >
        <span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-surface-container-lowest transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

function Segmented<T extends number>({ options, value, onChange, suffix, disabled }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; suffix?: string; disabled?: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`min-h-10 min-w-11 px-2.5 rounded-lg border text-xs font-bold font-mono ${
            value === o.value ? "bg-primary text-on-primary border-primary" : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container-low"
          }`}
        >
          {o.label}
        </button>
      ))}
      {suffix && <span className="text-xs text-on-surface-variant ml-1">{suffix}</span>}
    </div>
  );
}
