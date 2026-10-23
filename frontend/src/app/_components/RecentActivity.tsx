"use client";

import Link from "next/link";
import { ButtonLink, Card, EmptyState, OfflineBanner, OutcomeChip } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { outcomeOf } from "@/lib/abr";
import { MdArrowForward } from "react-icons/md";

export default function RecentActivity() {
  const { data, loading, error, refetch } = useBackend(api.sessions, 15_000);
  const sessions = (data?.sessions ?? []).slice(0, 5);

  return (
    <Card
      title="Recent sessions"
      flush
      action={<ButtonLink href="/records" variant="ghost" size="sm">Full history<MdArrowForward /></ButtonLink>}
    >
      {loading && <p className="px-5 py-10 text-center text-sm text-on-surface-variant">Loading sessions…</p>}
      {error && <div className="px-5 pb-5"><OfflineBanner message="Backend offline — no session history available." onRetry={refetch} /></div>}
      {!loading && !error && sessions.length === 0 && (
        <EmptyState title="No saved sessions yet">Run a scan and press Save session. It will show up here.</EmptyState>
      )}

      {sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-y border-outline-variant/50 text-xs font-medium text-on-surface-variant">
                <th className="px-5 py-2.5 font-medium">File</th>
                <th className="px-5 py-2.5 font-medium">Saved at</th>
                <th className="px-5 py-2.5 font-medium text-right">Trials</th>
                <th className="px-5 py-2.5 font-medium">Outcome</th>
                <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/50">
              {sessions.map(s => (
                <tr key={s.filename} className="hover:bg-surface-container-low/60">
                  <td className="px-5 py-3 font-mono text-xs">{s.filename}</td>
                  <td className="px-5 py-3 text-on-surface-variant whitespace-nowrap">{new Date(s.saved_at).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">{s.trial_count.toLocaleString()}</td>
                  <td className="px-5 py-3"><OutcomeChip outcome={outcomeOf(s)} /></td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/results?file=${encodeURIComponent(s.filename)}`} className="text-sm font-medium text-primary hover:underline">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
