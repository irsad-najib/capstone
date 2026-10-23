"use client";

import ABRWaveformChart from "@/components/ABRWaveformChart";
import { Badge, ButtonLink, Card, EmptyState, Stat } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { MIN_TRIALS, SNR_GOOD_DB, TARGET_TRIALS } from "@/lib/abr";
import { MdArrowForward, MdCloudOff, MdHearing } from "react-icons/md";

export default function ScanSummaryPanel() {
  const abr  = useBackend(api.abrResult, 3_000);
  const stim = useBackend(api.stim, 5_000);

  const r = abr.data;
  const trials = r?.trial_count ?? 0;
  const active = trials > 0 || !!stim.data?.running;
  const snr = r?.snr?.[0] ?? 0;

  return (
    <Card
      title="Current scan"
      className="h-full"
      action={active && <Badge tone="live" pulse>{stim.data?.running ? "Stimulus on" : "In progress"}</Badge>}
    >
      {abr.error ? (
        <EmptyState icon={<MdCloudOff />} title="Backend offline">No live scan data can be loaded right now.</EmptyState>
      ) : !active ? (
        <EmptyState
          icon={<MdHearing />}
          title="No scan running"
          action={<ButtonLink href="/scan" variant="outline" size="sm">Open live scan<MdArrowForward /></ButtonLink>}
        >
          Put the earphones on the patient, open Start Scan and press Start test. Progress shows up here while it runs.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2">
            <Stat label="Responses" value={`${trials.toLocaleString()} of ${TARGET_TRIALS}`} />
            <Stat
              label="Signal"
              value={trials < MIN_TRIALS ? "Measuring…" : snr >= SNR_GOOD_DB ? "Good" : "Weak"}
              tone={trials < MIN_TRIALS ? undefined : snr >= SNR_GOOD_DB ? "good" : "bad"}
            />
          </dl>
          {r && <ABRWaveformChart data={r} range={[0, 10]} height={180} compact />}
          <ButtonLink href="/scan" variant="ghost" size="sm" className="-ml-3">Open live scan<MdArrowForward /></ButtonLink>
        </div>
      )}
    </Card>
  );
}
