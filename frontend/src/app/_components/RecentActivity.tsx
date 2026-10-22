"use client";

import Link from "next/link";
import { OfflineBanner, OutcomeChip } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { outcomeOf } from "@/lib/abr";
import { MdArrowForward } from "react-icons/md";

export default function RecentActivity() {
  const { data, loading, error, refetch } = useBackend(api.sessions, 15_000);
  const sessions = (data?.sessions ?? []).slice(0, 5);

  return (
    <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden">
      <div className="px-5 py-4 flex justify-between items-center border-b border-outline-variant/60">
        <h2 className="text-base font-semibold text-primary">Recent sessions</h2>
        <Link href="/records" className="text-xs font-bold text-primary flex items-center gap-1 hover:underline">
          Full history <MdArrowForward className="text-[16px]" />
        </Link>
      </div>

      {loading && <p className="px-5 py-10 text-center text-sm text-on-surface-variant">Loading sessions…</p>}
      {error && <div className="p-5"><OfflineBanner message="Backend offline — no session history available." onRetry={refetch} /></div>}
      {!loading && !error && sessions.length === 0 && (
        <p className="px-5 py-8 text-center text-sm text-on-surface-variant">No saved sessions yet. Run a scan and press Save session.</p>
      )}

      {sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-surface-container-low text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                <th className="px-5 py-3">File</th>
                <th className="px-5 py-3">Saved at</th>
                <th className="px-5 py-3 text-right">Trials</th>
                <th className="px-5 py-3">Outcome</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60">
              {sessions.map(s => (
                <tr key={s.filename} className="hover:bg-surface-container-low/50">
                  <td className="px-5 py-3 font-mono text-xs font-semibold">{s.filename}</td>
                  <td className="px-5 py-3 text-on-surface-variant whitespace-nowrap">{new Date(s.saved_at).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">{s.trial_count.toLocaleString()}</td>
                  <td className="px-5 py-3"><OutcomeChip outcome={outcomeOf(s)} /></td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/results?file=${encodeURIComponent(s.filename)}`} className="px-3 py-2 rounded-lg text-primary text-xs font-bold hover:bg-surface-container">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
