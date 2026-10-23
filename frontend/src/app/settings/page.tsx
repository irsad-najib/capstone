"use client";

import { useState } from "react";
import TopBar from "@/components/TopBar";
import { Button, Card, Field, Footer, Page, Segmented, Toggle, inputClass } from "@/components/ui";
import { MIN_TRIALS } from "@/lib/abr";
import { DEFAULT_SETTINGS, useSettings, writeSettings, type Theme } from "@/lib/settings";
import { MdDarkMode, MdLightMode, MdSettingsBrightness } from "react-icons/md";

const INTERVALS = [1, 5, 15, 30, 60];
const DB_LEVELS = [40, 50, 60, 70, 80, 90];
const TEST_LEVELS = [90, 80, 70, 60, 50, 40, 30, 20];

export default function SettingsPage() {
  const s = useSettings();
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

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
      <TopBar title="Settings" />

      <Page narrow>
        <Card title="Hearing test" description="Used when you press Start test.">
          <div className="space-y-6">
            <Field label="Test levels" hint="Each ear is tested at these levels, loudest first. Pick at least one.">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Test levels">
                {TEST_LEVELS.map(v => {
                  const on = s.testLevels.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        if (on && s.testLevels.length === 1) return;
                        writeSettings({ testLevels: on ? s.testLevels.filter(x => x !== v) : [...s.testLevels, v] });
                      }}
                      className={`h-9 min-w-12 px-3 rounded-full text-sm font-medium tabular-nums transition-colors ${
                        on ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
                      }`}
                    >
                      {v}
                    </button>
                  );
                })}
                <span className="text-sm text-on-surface-variant">dB</span>
              </div>
            </Field>
            <Toggle
              label="Stop at threshold"
              hint="Skip the quieter levels once an ear stops responding. Faster, and the threshold stays the same."
              checked={s.stopAtThreshold}
              onChange={v => writeSettings({ stopAtThreshold: v })}
            />
          </div>
        </Card>

        <Card title="Scan defaults">
          <div className="space-y-6">
            <Field label="Manual stimulus level" hint="Level for manual recording. The automatic test uses the levels chosen on the scan page.">
              <Segmented
                label="Stimulus level"
                options={DB_LEVELS.map(v => ({ value: v, label: <span className="font-mono tabular-nums">{v}</span> }))}
                value={s.stimDb}
                onChange={v => writeSettings({ stimDb: v })}
              />
              <span className="ml-2 text-sm text-on-surface-variant">dB</span>
            </Field>
            <Field label="Responses per level" htmlFor="target-trials" hint={`How many responses each level collects before moving on. The backend needs ≥500 to converge (minimum ${MIN_TRIALS}).`}>
              <input
                id="target-trials"
                type="number" min={MIN_TRIALS} max={5000} step={50}
                value={s.targetTrials}
                onChange={e => writeSettings({ targetTrials: Math.max(MIN_TRIALS, Math.min(5000, Number(e.target.value) || DEFAULT_SETTINGS.targetTrials)) })}
                className={`${inputClass} w-32 font-mono tabular-nums`}
              />
            </Field>
            <Toggle
              label="Auto-save when target is reached"
              hint="Also saves manual recordings when they reach the target. The automatic test always saves."
              checked={s.autoSave}
              onChange={v => writeSettings({ autoSave: v })}
            />
          </div>
        </Card>

        <Card title="Notifications">
          <div className="space-y-6">
            <Toggle
              label="Enable notifications"
              hint="Alert when a scan converges, the backend goes offline, or a device disconnects."
              checked={s.notifications}
              onChange={toggleNotifications}
            />
            {notifyMsg && <p role="alert" className="text-sm text-error">{notifyMsg}</p>}
            <Field label="Repeat interval" hint="Minimum time between two alerts of the same kind.">
              <Segmented
                label="Repeat interval"
                options={INTERVALS.map(v => ({ value: v, label: <span className="font-mono tabular-nums">{v}</span> }))}
                value={s.notifyIntervalMin}
                onChange={v => writeSettings({ notifyIntervalMin: v })}
                disabled={!s.notifications}
              />
              <span className="ml-2 text-sm text-on-surface-variant">min</span>
            </Field>
          </div>
        </Card>

        <Card title="Appearance">
          <Field label="Theme">
            <Segmented
              label="Theme"
              value={s.theme}
              onChange={(v: Theme) => writeSettings({ theme: v })}
              options={[
                { value: "system", label: <><MdSettingsBrightness />System</> },
                { value: "light",  label: <><MdLightMode />Light</> },
                { value: "dark",   label: <><MdDarkMode />Dark</> },
              ]}
            />
          </Field>
        </Card>

        <Button variant="ghost" size="sm" className="-ml-3 hover:text-error" onClick={() => writeSettings(DEFAULT_SETTINGS)}>
          Reset all settings to defaults
        </Button>

        <Footer />
      </Page>
    </>
  );
}
