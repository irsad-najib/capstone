"use client";

import Link from "next/link";
import ABRWaveformChart from "@/components/ABRWaveformChart";
import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { MIN_TRIALS, SNR_GOOD_DB, TARGET_TRIALS, statusLabel } from "@/lib/abr";
import { MdArrowForward, MdHearing } from "react-icons/md";

export default function ScanSummaryPanel() {
  const abr  = useBackend(api.abrResult, 3_000);
  const stim = useBackend(api.stim, 5_000);

  const r = abr.data;
  const trials = r?.trial_count ?? 0;
  const active = trials > 0 || !!stim.data?.running;
  const snr = r?.snr?.[0] ?? 0;

  return (
    <section className="h-full bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-primary">Current scan</h2>
        {active && (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-error text-on-error text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-on-error pulse-red" />{stim.data?.running ? "STIMULUS ON" : "IN PROGRESS"}
          </span>
        )}
      </div>

      {abr.error ? (
        <p className="flex-1 flex items-center justify-center text-sm text-on-surface-variant py-8">Backend offline — no live scan data.</p>
      ) : !active ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-8">
          <MdHearing className="text-4xl text-outline" />
          <p className="text-sm font-semibold text-on-surface">No scan running</p>
          <p className="text-xs text-on-surface-variant max-w-sm">Put the headset on the patient, open Start Scan and press Start stimulus. The averaged waveform appears here while it builds up.</p>
          <Link href="/scan" className="mt-2 text-xs font-bold text-primary flex items-center gap-1 hover:underline">Open live scan <MdArrowForward /></Link>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-[11px] uppercase tracking-widest font-bold text-on-surface-variant">Trials</dt>
              <dd className="text-2xl font-bold text-primary tabular-nums">{trials.toLocaleString()}</dd>
              <dd className="text-[11px] text-on-surface-variant">{trials < MIN_TRIALS ? "insufficient" : trials < TARGET_TRIALS ? `of ${TARGET_TRIALS}` : "target reached"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-widest font-bold text-on-surface-variant">SNR Ch 1</dt>
              <dd className={`text-2xl font-bold tabular-nums ${snr >= SNR_GOOD_DB ? "text-secondary" : "text-primary"}`}>{snr.toFixed(1)}<span className="text-sm font-normal"> dB</span></dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-widest font-bold text-on-surface-variant">Status</dt>
              <dd className="text-lg font-bold text-primary">{statusLabel(r?.status ?? r?.quality)}</dd>
            </div>
          </dl>
          {r && <ABRWaveformChart data={r} range={[0, 10]} height={140} compact />}
          <Link href="/scan" className="w-fit text-xs font-bold text-primary flex items-center gap-1 hover:underline">Open live scan <MdArrowForward /></Link>
        </>
      )}
    </section>
  );
}
