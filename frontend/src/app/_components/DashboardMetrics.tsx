"use client";

import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { outcomeOf } from "@/lib/abr";
import { MdCalendarToday, MdFolder, MdTimeline, MdVerified } from "react-icons/md";

const WEEK_MS = 7 * 24 * 3600 * 1000;

export default function DashboardMetrics() {
  const { data, loading, error } = useBackend(api.sessions, 15_000);
  const sessions = data?.sessions ?? [];

  // Hasil final saja (Pass/Refer) yang dihitung untuk pass rate
  const outcomes = sessions.map(outcomeOf);
  const pass = outcomes.filter(o => o === "Pass").length;
  const decided = outcomes.filter(o => o === "Pass" || o === "Refer").length;
  const newest = sessions.reduce((t, s) => Math.max(t, new Date(s.saved_at).getTime()), 0);
  const thisWeek = sessions.filter(s => newest - new Date(s.saved_at).getTime() < WEEK_MS).length;
  const avgTrials = sessions.length ? Math.round(sessions.reduce((n, s) => n + s.trial_count, 0) / sessions.length) : 0;

  const empty = loading ? "…" : error ? "—" : null;
  const metrics = [
    { label: "Total sessions", value: empty ?? sessions.length.toString(), sub: "saved on backend", icon: MdFolder },
    { label: "This week", value: empty ?? thisWeek.toString(), sub: "within 7 days of latest", icon: MdCalendarToday },
    { label: "Pass rate", value: empty ?? (decided ? `${Math.round((pass / decided) * 100)}%` : "—"), sub: decided ? `${pass} of ${decided} converged sessions` : "no converged sessions yet", icon: MdVerified },
    { label: "Avg. trials", value: empty ?? (sessions.length ? avgTrials.toLocaleString() : "—"), sub: "per session", icon: MdTimeline },
  ];

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
      {metrics.map(({ label, value, sub, icon: Icon }) => (
        <div key={label} className="bg-surface-container-lowest border border-outline-variant p-5 rounded-2xl flex flex-col justify-between gap-4 min-h-32">
          <div className="flex justify-between items-start gap-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
            <Icon className="text-outline text-xl shrink-0" />
          </div>
          <div>
            <p className="text-2xl md:text-3xl font-bold text-primary tabular-nums">{value}</p>
            <p className="text-xs text-on-surface-variant mt-0.5">{sub}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
