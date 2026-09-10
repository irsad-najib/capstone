"use client";

import { useState } from "react";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import {
  MdDarkMode,
  MdLanguage,
  MdLightMode,
  MdNotificationsActive,
  MdPalette,
  MdSave,
  MdSchedule,
  MdSettingsApplications,
  MdTune,
} from "react-icons/md";

const intervals = [5, 10, 15, 30, 60];

export default function SettingsPage() {
  const [notifications, setNotifications] = useState(true);
  const [interval, setIntervalValue] = useState(15);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [language, setLanguage] = useState("id");

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div>
              <h1 className="text-lg font-extrabold text-primary">Settings</h1>
              <p className="text-[11px] text-on-surface-variant">Notification and application preferences</p>
            </div>
          </>
        }
        right={
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:opacity-90 transition-all active:scale-95">
            <MdSave className="text-lg" />
            Save
          </button>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-6">
        <section className="grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6">
          <div className="bg-primary text-white rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#cde5ff] text-primary flex items-center justify-center">
                <MdSettingsApplications className="text-2xl" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Settings Menu</p>
                <h2 className="text-2xl font-bold">Application Controls</h2>
              </div>
            </div>
            <div className="mt-8 space-y-3">
              <MenuNode icon={MdNotificationsActive} title="Notifikasi" desc="Aktifkan notifikasi dan interval repetisi" active />
              <MenuNode icon={MdTune} title="Preferensi Aplikasi" desc="Tema dan bahasa aplikasi" active />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Panel title="Notifikasi" icon={MdNotificationsActive}>
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-on-surface">Aktifkan Notifikasi</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">Alert untuk scan selesai, backend offline, dan device disconnect.</p>
                  </div>
                  <button
                    onClick={() => setNotifications(v => !v)}
                    className={`relative h-7 w-12 rounded-full transition-colors ${notifications ? "bg-secondary" : "bg-outline-variant"}`}
                    aria-pressed={notifications}
                  >
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${notifications ? "translate-x-5" : "translate-x-1"}`} />
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-on-surface">
                    <MdSchedule className="text-secondary text-lg" />
                    Atur Interval Repetisi
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {intervals.map(value => (
                      <button
                        key={value}
                        onClick={() => setIntervalValue(value)}
                        className={`h-10 rounded-xl border text-xs font-bold transition-colors ${
                          interval === value
                            ? "bg-primary text-white border-primary"
                            : "bg-white text-on-surface border-outline-variant hover:bg-surface-container-low"
                        }`}
                      >
                        {value}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Preferensi Aplikasi" icon={MdPalette}>
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-sm font-bold text-on-surface">Pilih Tema</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "system" as const, label: "System", icon: MdSettingsApplications },
                      { value: "light" as const, label: "Light", icon: MdLightMode },
                      { value: "dark" as const, label: "Dark", icon: MdDarkMode },
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={`h-16 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-colors ${
                          theme === value
                            ? "bg-primary text-white border-primary"
                            : "bg-white text-on-surface border-outline-variant hover:bg-surface-container-low"
                        }`}
                      >
                        <Icon className="text-lg" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-on-surface">
                    <MdLanguage className="text-secondary text-lg" />
                    Pilih Bahasa
                  </div>
                  <select
                    value={language}
                    onChange={e => setLanguage(e.target.value)}
                    className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="id">Bahasa Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            </Panel>
          </div>
        </section>

        <section className="bg-white border border-outline-variant/60 rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-primary">Settings Flow</h2>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <FlowBox label="Settings" strong />
            <FlowBox label="Notifikasi" />
            <FlowBox label="Preferensi Aplikasi" />
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
            <FlowBox label="Aktifkan Notifikasi" />
            <FlowBox label="Atur Interval Repetisi" />
            <FlowBox label="Pilih Tema" />
            <FlowBox label="Pilih Bahasa" />
          </div>
        </section>
      </main>
    </>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-outline-variant/60 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        <Icon className="text-secondary text-2xl" />
      </div>
      {children}
    </section>
  );
}

function MenuNode({
  icon: Icon,
  title,
  desc,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  active?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${active ? "bg-white/10 border-white/10" : "border-white/5"}`}>
      <div className="flex items-center gap-3">
        <Icon className="text-[#cde5ff] text-xl" />
        <div>
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="text-xs text-white/50 mt-0.5">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function FlowBox({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-center text-xs font-bold ${
      strong
        ? "bg-primary text-white border-primary"
        : "bg-surface-container-low text-on-surface border-outline-variant"
    }`}>
      {label}
    </div>
  );
}
