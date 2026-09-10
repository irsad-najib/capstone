"use client";

import { useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import { useBackend } from "@/hooks/useBackend";
import { api, type SessionMeta } from "@/lib/api";
import MenuButton from "@/components/MenuButton";
import { MdCloudOff, MdDownload, MdNotifications, MdRefresh, MdSearch } from "react-icons/md";

/* ── Result badge helpers ─────────────────────────────────────── */
function badge(s: SessionMeta): { text: string; style: string; dotStyle: string } {
  if (s.trial_count >= 500)
    return { text: "Normal",       style: "bg-secondary-container text-on-secondary-container", dotStyle: "bg-secondary" };
  if (s.trial_count >= 100)
    return { text: "Inconclusive", style: "bg-tertiary-fixed text-on-tertiary-fixed-variant",  dotStyle: "bg-on-tertiary-container" };
  return   { text: "Insufficient", style: "bg-error-container text-on-error-container",         dotStyle: "bg-error" };
}

export default function RecordsPage() {
  const { data, loading, error, refetch } = useBackend(api.sessions, 15_000);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const allSessions = data?.sessions ?? [];

  const filtered = allSessions.filter(s => {
    const matchSearch = s.filename.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filter === "normal")       return s.trial_count >= 500;
    if (filter === "inconclusive") return s.trial_count >= 100 && s.trial_count < 500;
    if (filter === "insufficient") return s.trial_count < 100;
    return true;
  });

  const counts = {
    normal:       allSessions.filter(s => s.trial_count >= 500).length,
    inconclusive: allSessions.filter(s => s.trial_count >= 100 && s.trial_count < 500).length,
    insufficient: allSessions.filter(s => s.trial_count < 100).length,
  };

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <span className="hidden md:block text-xl font-extrabold text-primary">Neurosound</span>
          </>
        }
        right={
          <>
            <button
              onClick={refetch}
              className="w-9 h-9 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors"
              title="Refresh"
            >
              <MdRefresh className="text-xl" />
            </button>
            <button className="w-9 h-9 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors">
              <MdNotifications className="text-xl" />
            </button>
          </>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 space-y-6 max-w-7xl mx-auto">

        {/* ── Page header ──────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-on-surface">Session History</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              {loading ? "Loading…" : `${allSessions.length} saved sessions`}
            </p>
          </div>
          <a
            href={`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080"}/api/v1/sessions`}
            target="_blank"
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-xs font-bold hover:opacity-90 transition-all active:scale-95 shadow-sm"
          >
            <MdDownload className="text-[18px]" />
            Export JSON
          </a>
        </div>

        {/* ── Search + filter ───────────────────────────────────── */}
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <MdSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]" />
            <input
              className="w-full bg-white border border-outline-variant rounded-xl py-3 pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary shadow-sm transition-all"
              placeholder="Search by filename…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="w-full md:w-auto bg-white border border-outline-variant rounded-xl py-3 px-4 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary shadow-sm min-w-40"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="all">Result: All</option>
            <option value="normal">Normal (≥500 trials)</option>
            <option value="inconclusive">Inconclusive (100–499)</option>
            <option value="insufficient">Insufficient (&lt;100)</option>
          </select>
        </div>

        {/* ── Stats chips ───────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3">
          {[
            { dot: "bg-secondary",              label: `${counts.normal} Normal`       },
            { dot: "bg-on-tertiary-container",  label: `${counts.inconclusive} Inconclusive` },
            { dot: "bg-error",                  label: `${counts.insufficient} Insufficient` },
          ].map(({ dot, label }) => (
            <div key={label} className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-full border border-outline-variant">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              <span className="text-xs font-semibold">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Table ────────────────────────────────────────────── */}
        <div className="bg-white border border-outline-variant rounded-2xl overflow-hidden shadow-sm">

          {/* Backend offline message */}
          {error && (
            <div className="px-6 py-12 text-center text-sm text-on-surface-variant space-y-2">
              <MdCloudOff className="mx-auto text-[36px] text-outline" />
              <p>Backend offline — start the Go server to load session history.</p>
              <p className="font-mono text-xs">{String(error)}</p>
              <button onClick={refetch} className="mt-3 px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold">
                Retry
              </button>
            </div>
          )}

          {loading && !data && (
            <div className="px-6 py-12 text-center text-sm text-on-surface-variant">Loading sessions…</div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-on-surface-variant">
              {allSessions.length === 0
                ? "No saved sessions yet. Run a scan and press Save."
                : "No sessions match your search."}
            </div>
          )}

          {filtered.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-xs font-semibold text-on-surface-variant border-b border-outline-variant">
                      <th className="px-6 py-4">Filename</th>
                      <th className="px-6 py-4">Saved At</th>
                      <th className="px-6 py-4">Trials</th>
                      <th className="px-6 py-4">Result</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {filtered.map(s => {
                      const { text, style, dotStyle } = badge(s);
                      return (
                        <tr key={s.filename} className="hover:bg-surface-container-low/30 transition-colors">
                          <td className="px-6 py-5">
                            <p className="text-xs font-bold font-mono text-on-surface">{s.filename}</p>
                          </td>
                          <td className="px-6 py-5 text-sm text-on-surface-variant">
                            {new Date(s.saved_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-5 font-mono text-sm">{s.trial_count.toLocaleString()}</td>
                          <td className="px-6 py-5">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${style}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${dotStyle}`} />
                              {text}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <Link
                              href={`/results?file=${encodeURIComponent(s.filename)}`}
                              className="text-primary hover:bg-primary-container/20 px-4 py-2 rounded-lg text-xs font-bold transition-colors"
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
              <div className="px-6 py-4 border-t border-outline-variant">
                <p className="text-xs text-on-surface-variant">
                  Showing all {filtered.length} matching sessions
                </p>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <footer className="flex flex-col md:flex-row justify-between items-center py-5 px-6 bg-surface-container-low border border-outline-variant rounded-2xl text-xs text-on-surface-variant">
          <p>© 2024 Neurosound Medical Systems. FDA Cleared.</p>
          <div className="flex gap-6 mt-3 md:mt-0">
            <a href="#" className="hover:text-primary transition-colors">Support</a>
            <a href="#" className="hover:text-primary transition-colors">Privacy</a>
          </div>
        </footer>
      </main>
    </>
  );
}
