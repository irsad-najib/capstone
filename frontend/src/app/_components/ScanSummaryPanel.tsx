"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useBackend } from "@/hooks/useBackend";
import { MdPlayCircle, MdSignalCellularAlt, MdSensors, MdTaskAlt, MdTimeline } from "react-icons/md";

export default function ScanSummaryPanel() {
  const devices = useBackend(api.devices, 5_000);
  const abr = useBackend(api.abrResult, 3_000);

  const deviceName = devices.data?.devices?.[0] ?? "No device";
  const connected = (devices.data?.devices?.length ?? 0) > 0;
  const trials = abr.data?.trial_count ?? 0;
  const snr = abr.data?.snr?.[0] ?? 0;
  const quality = abr.data?.quality ?? "Noise";
  const ready = connected || trials > 0;

  const stats = [
    { label: "Device", value: deviceName, icon: MdSensors },
    { label: "Trials", value: trials > 0 ? trials.toLocaleString() : "0", icon: MdTimeline },
    { label: "SNR Ch 0", value: `${snr.toFixed(1)} dB`, icon: MdSignalCellularAlt },
  ];

  return (
    <section className="bg-primary text-white rounded-2xl border border-primary/20 shadow-lg overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr]">
        <div className="p-6 md:p-8 flex flex-col justify-between gap-8">
          <div className="space-y-3">
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${
              ready ? "bg-secondary text-white" : "bg-white/10 text-[#cde5ff]"
            }`}>
              <span className={`w-2 h-2 rounded-full ${ready ? "bg-white animate-pulse" : "bg-outline-variant"}`} />
              {ready ? "Ready for Acquisition" : "Waiting for Device"}
            </div>
            <div>
              <h3 className="text-2xl md:text-3xl font-bold tracking-tight">ABR Screening Session</h3>
              <p className="text-sm text-[#cde5ff]/75 mt-2 max-w-xl leading-relaxed">
                Start a live scan when the acquisition board is connected. Session data will be available from History after saving.
              </p>
            </div>
          </div>

          <Link
            href="/scan"
            className="w-fit flex items-center gap-2 bg-[#cde5ff] text-primary px-5 py-3 rounded-xl text-xs font-bold hover:bg-white transition-all active:scale-95 shadow-lg"
          >
            <MdPlayCircle className="text-xl" />
            Initiate Scan
          </Link>
        </div>

        <div className="bg-white/[0.04] border-t lg:border-t-0 lg:border-l border-white/10 p-6 md:p-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#cde5ff]/60">Current State</p>
              <p className="text-xl font-bold text-white mt-1">{quality}</p>
            </div>
            <MdTaskAlt className="text-secondary-fixed-dim text-2xl" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#cde5ff]/55">{label}</span>
                  <Icon className="text-[#cde5ff]/70 text-lg" />
                </div>
                <p className="mt-2 text-sm font-bold text-white truncate">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
