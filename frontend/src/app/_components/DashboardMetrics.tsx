"use client";

import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { outcomeOf } from "@/lib/abr";

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
    { label: "Total sessions", value: empty ?? sessions.length.toString(), sub: "saved on backend" },
    { label: "This week", value: empty ?? thisWeek.toString(), sub: "within 7 days of latest" },
    { label: "Pass rate", value: empty ?? (decided ? `${Math.round((pass / decided) * 100)}%` : "—"), sub: decided ? `${pass} of ${decided} converged sessions` : "no converged sessions yet" },
    { label: "Avg. trials", value: empty ?? (sessions.length ? avgTrials.toLocaleString() : "—"), sub: "per session" },
  ];

  return (
    <section
      aria-label="Session metrics"
      className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-outline-variant/60 bg-outline-variant/60"
    >
      {metrics.map(({ label, value, sub }) => (
        <div key={label} className="bg-surface-container-lowest px-5 py-4 md:py-5 min-w-0">
          <p className="text-sm text-on-surface-variant">{label}</p>
          <p className="mt-2 text-[28px] leading-9 font-semibold tracking-tight text-on-surface tabular-nums">{value}</p>
          <p className="text-xs text-on-surface-variant truncate">{sub}</p>
        </div>
      ))}
    </section>
  );
}
