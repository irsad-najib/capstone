"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import { Footer, OfflineBanner, OutcomeChip } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, type SessionMeta } from "@/lib/api";
import { MIN_TRIALS, TARGET_TRIALS, downloadJSON, outcomeOf } from "@/lib/abr";
import { MdArrowDownward, MdArrowUpward, MdDownload, MdRefresh, MdSearch } from "react-icons/md";

/* Filter berdasarkan jumlah trial (lihat design brief §5.3) */
const FILTERS = [
  { key: "all",          label: "All",          test: () => true },
  { key: "normal",       label: `Normal (≥${TARGET_TRIALS})`,          test: (s: SessionMeta) => s.trial_count >= TARGET_TRIALS },
  { key: "inconclusive", label: `Inconclusive (${MIN_TRIALS}–${TARGET_TRIALS - 1})`, test: (s: SessionMeta) => s.trial_count >= MIN_TRIALS && s.trial_count < TARGET_TRIALS },
  { key: "insufficient", label: `Insufficient (<${MIN_TRIALS})`,       test: (s: SessionMeta) => s.trial_count < MIN_TRIALS },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];
const PAGE = 20;

export default function RecordsPage() {
  const { data, loading, error, refetch } = useBackend(api.sessions, 15_000);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  const all = useMemo(() => data?.sessions ?? [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = FILTERS.find(x => x.key === filter)!;
    return all
      .filter(s => f.test(s) && (!q || s.filename.toLowerCase().includes(q) || (s.device ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (newestFirst ? -1 : 1) * (new Date(a.saved_at).getTime() - new Date(b.saved_at).getTime()));
  }, [all, search, filter, newestFirst]);
  const shown = filtered.slice(0, limit);

  async function download(filename: string) {
    setDownloading(filename);
    setDlError(null);
    try {
      downloadJSON(filename, await api.session(filename));
    } catch (e) {
      setDlError(`${filename}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <h1 className="text-lg font-bold text-primary">Session History</h1>
          </>
        }
        right={
          <button onClick={refetch} className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low rounded-full" title="Refresh" aria-label="Refresh">
            <MdRefresh className="text-xl" />
          </button>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-primary">Saved sessions</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              {loading ? "Loading…" : `${all.length} sessions on the backend`}
            </p>
          </div>
          <button
            onClick={() => downloadJSON(`neurosound_sessions_${new Date().toISOString().slice(0, 10)}.json`, filtered)}
            disabled={!filtered.length}
            className="min-h-10 flex items-center gap-2 px-4 bg-primary text-on-primary rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-40"
          >
            <MdDownload className="text-[18px]" />Export list (JSON)
          </button>
        </div>

        {error && <OfflineBanner message="Backend offline — start the Go server to load session history." onRetry={refetch} />}
        {dlError && <p role="alert" className="rounded-xl px-4 py-3 text-sm bg-error-container text-on-error-container">Download failed — {dlError}</p>}

        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <MdSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]" />
            <input
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg py-2.5 pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary"
              placeholder="Search filename or device…"
              value={search}
              onChange={e => { setSearch(e.target.value); setLimit(PAGE); }}
            />
          </div>
          <button
            onClick={() => setNewestFirst(v => !v)}
            className="min-h-10 flex items-center gap-1.5 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs font-bold text-primary"
          >
            {newestFirst ? <MdArrowDownward /> : <MdArrowUpward />}{newestFirst ? "Newest first" : "Oldest first"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by trial count">
          {FILTERS.map(f => {
            const count = all.filter(f.test).length;
            return (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setLimit(PAGE); }}
                aria-pressed={filter === f.key}
                className={`min-h-9 px-3.5 rounded-full border text-xs font-semibold ${
                  filter === f.key ? "bg-primary text-on-primary border-primary" : "bg-surface-container-lowest border-outline-variant text-on-surface hover:bg-surface-container-low"
                }`}
              >
                {f.label} · {count}
              </button>
            );
          })}
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden">
          {loading && !data && <p className="px-6 py-12 text-center text-sm text-on-surface-variant">Loading sessions…</p>}

          {!loading && !error && shown.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-on-surface-variant space-y-3">
              <p>{all.length === 0 ? "No saved sessions yet. Run a scan and press Save session." : "No sessions match your search."}</p>
              {all.length === 0 && <Link href="/scan" className="inline-block px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-bold">Start a scan</Link>}
            </div>
          )}

          {shown.length > 0 && (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-surface-container-low text-xs font-semibold text-on-surface-variant border-b border-outline-variant">
                      <th className="px-5 py-3">Filename</th>
                      <th className="px-5 py-3">Saved at</th>
                      <th className="px-5 py-3">Ear / Level</th>
                      <th className="px-5 py-3 text-right">Trials</th>
                      <th className="px-5 py-3 text-right">SNR Ch 1</th>
                      <th className="px-5 py-3">Result</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/60">
                    {shown.map(s => (
                      <tr key={s.filename} className="hover:bg-surface-container-low/50">
                        <td className="px-5 py-3">
                          <p className="text-xs font-bold font-mono">{s.filename}</p>
                          {s.device && <p className="text-[11px] text-on-surface-variant font-mono">{s.device}</p>}
                        </td>
                        <td className="px-5 py-3 text-on-surface-variant whitespace-nowrap">{new Date(s.saved_at).toLocaleString()}</td>
                        <td className="px-5 py-3 text-on-surface-variant">{s.ear ? (s.ear === "left" ? "Left" : "Right") : "—"}{s.stim_db ? ` · ${s.stim_db} dB` : ""}</td>
                        <td className="px-5 py-3 text-right font-mono tabular-nums">{s.trial_count.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right font-mono tabular-nums">{s.snr?.[0] != null ? `${s.snr[0].toFixed(1)} dB` : "—"}</td>
                        <td className="px-5 py-3"><OutcomeChip outcome={outcomeOf(s)} /></td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <Link href={`/results?file=${encodeURIComponent(s.filename)}`} className="px-3 py-2 rounded-lg text-xs font-bold text-primary hover:bg-surface-container">View</Link>
                          <button onClick={() => download(s.filename)} disabled={downloading === s.filename} className="px-3 py-2 rounded-lg text-xs font-bold text-primary hover:bg-surface-container disabled:opacity-50">
                            {downloading === s.filename ? "…" : "JSON"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="md:hidden divide-y divide-outline-variant/60">
                {shown.map(s => (
                  <li key={s.filename} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-bold font-mono break-all">{s.filename}</p>
                      <OutcomeChip outcome={outcomeOf(s)} />
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      {new Date(s.saved_at).toLocaleString()} · {s.trial_count.toLocaleString()} trials
                      {s.snr?.[0] != null && ` · ${s.snr[0].toFixed(1)} dB`}
                      {s.ear && ` · ${s.ear === "left" ? "Left" : "Right"}`}
                    </p>
                    <div className="flex gap-2">
                      <Link href={`/results?file=${encodeURIComponent(s.filename)}`} className="min-h-11 flex-1 flex items-center justify-center rounded-lg bg-primary text-on-primary text-xs font-bold">View result</Link>
                      <button onClick={() => download(s.filename)} className="min-h-11 px-4 rounded-lg border border-outline-variant text-xs font-bold text-primary">JSON</button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="px-5 py-3 border-t border-outline-variant flex items-center justify-between text-xs text-on-surface-variant">
                <span>Showing {shown.length} of {filtered.length}</span>
                {shown.length < filtered.length && (
                  <button onClick={() => setLimit(l => l + PAGE)} className="min-h-9 px-3 rounded-lg font-bold text-primary hover:bg-surface-container">Load more</button>
                )}
              </div>
            </>
          )}
        </div>

        <Footer />
      </main>
    </>
  );
}
