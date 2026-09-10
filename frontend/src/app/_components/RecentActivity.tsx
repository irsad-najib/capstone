"use client";

import Link from "next/link";
import { useBackend } from "@/hooks/useBackend";
import { api, type SessionMeta } from "@/lib/api";
import { MdArrowForward, MdCloudOff } from "react-icons/md";

function outcomeLabel(s: SessionMeta): { text: string; cls: string } {
  if (s.trial_count >= 500) return { text: "Normal",      cls: "bg-secondary-container/50 text-secondary" };
  if (s.trial_count >= 100) return { text: "Inconclusive", cls: "bg-tertiary-fixed/50 text-on-tertiary-fixed-variant" };
  return                          { text: "Insufficient", cls: "bg-error-container/50 text-error" };
}

export default function RecentActivity() {
  const { data, loading, error } = useBackend(api.sessions, 10_000);
  const sessions = (data?.sessions ?? []).slice(0, 5);

  return (
    <section className="bg-white rounded-2xl border border-outline-variant/60 overflow-hidden shadow-sm">
      <div className="px-6 py-4 flex justify-between items-center border-b border-outline-variant/30">
        <h4 className="text-lg font-semibold text-primary">Recent Sessions</h4>
        <Link href="/records" className="text-xs font-bold text-primary flex items-center gap-1 hover:gap-2 transition-all">
          Full History
          <MdArrowForward className="text-[18px]" />
        </Link>
      </div>

      {loading && (
        <div className="px-6 py-10 text-center text-sm text-on-surface-variant">
          Loading sessions…
        </div>
      )}

      {error && (
        <div className="px-6 py-6 text-center text-sm text-on-surface-variant">
          <MdCloudOff className="mx-auto mb-2 text-outline text-2xl" />
          Backend offline — no session history available.
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="px-6 py-8 text-center text-sm text-on-surface-variant">
          No saved sessions yet. Run a scan and press Save.
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                <th className="px-6 py-4">File</th>
                <th className="px-6 py-4">Saved At</th>
                <th className="px-6 py-4">Trials</th>
                <th className="px-6 py-4">Outcome</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm text-on-surface divide-y divide-outline-variant/30">
              {sessions.map(s => {
                const { text, cls } = outcomeLabel(s);
                return (
                  <tr key={s.filename} className="hover:bg-surface-container-low/30 transition-colors">
                    <td className="px-6 py-4 font-semibold font-mono text-xs">{s.filename}</td>
                    <td className="px-6 py-4 text-on-surface-variant">
                      {new Date(s.saved_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-mono">{s.trial_count.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-lg ${cls}`}>
                        {text}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/results?file=${encodeURIComponent(s.filename)}`}
                        className="text-primary text-xs font-bold hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
