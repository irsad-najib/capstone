"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import { Button, ButtonLink, EmptyState, Footer, Notice, OfflineBanner, OutcomeChip, Page, inputClass } from "@/components/ui";
import { useBackend } from "@/hooks/useBackend";
import { api, type SessionMeta } from "@/lib/api";
import { MIN_TRIALS, TARGET_TRIALS, downloadJSON, outcomeOf } from "@/lib/abr";
import { MdArrowDownward, MdArrowUpward, MdDownload, MdHistory, MdRefresh, MdSearch } from "react-icons/md";

/* Filter berdasarkan jumlah trial (lihat design brief §5.3) */
const FILTERS = [
  { key: "all",          label: "All",          test: () => true },
  { key: "normal",       label: "Complete",     test: (s: SessionMeta) => s.trial_count >= TARGET_TRIALS },
  { key: "inconclusive", label: "Inconclusive", test: (s: SessionMeta) => s.trial_count >= MIN_TRIALS && s.trial_count < TARGET_TRIALS },
  { key: "insufficient", label: "Too short",    test: (s: SessionMeta) => s.trial_count < MIN_TRIALS },
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
        title="History"
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={refetch} title="Refresh" aria-label="Refresh"><MdRefresh /></Button>
            <Button
              variant="outline"
              onClick={() => downloadJSON(`neurosound_sessions_${new Date().toISOString().slice(0, 10)}.json`, filtered)}
              disabled={!filtered.length}
              className="hidden sm:inline-flex"
            >
              <MdDownload />Export list
            </Button>
          </>
        }
      />

      <Page>
        {error && <OfflineBanner message="Backend offline — start the Go server to load session history." onRetry={refetch} />}
        {dlError && <Notice kind="error">Download failed — {dlError}</Notice>}

        {/* ── Toolbar ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl pointer-events-none" />
              <input
                type="search"
                aria-label="Search sessions"
                className={`${inputClass} pl-10`}
                placeholder="Search sessions"
                value={search}
                onChange={e => { setSearch(e.target.value); setLimit(PAGE); }}
              />
            </div>
            <Button variant="outline" onClick={() => setNewestFirst(v => !v)}>
              {newestFirst ? <MdArrowDownward /> : <MdArrowUpward />}<span className="hidden sm:inline">{newestFirst ? "Newest first" : "Oldest first"}</span>
            </Button>
          </div>

          <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 md:mx-0 md:px-0" role="group" aria-label="Filter by trial count">
            {FILTERS.map(f => {
              const count = all.filter(f.test).length;
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => { setFilter(f.key); setLimit(PAGE); }}
                  aria-pressed={on}
                  className={`shrink-0 h-8 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                    on ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {f.label}
                  <span className={`tabular-nums ${on ? "opacity-80" : "text-outline"}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl overflow-hidden">
          {loading && !data && <p className="px-6 py-12 text-center text-sm text-on-surface-variant">Loading sessions…</p>}

          {!loading && !error && shown.length === 0 && (
            all.length === 0 ? (
              <EmptyState
                icon={<MdHistory />}
                title="No saved sessions yet"
                action={<ButtonLink href="/scan" variant="secondary" size="sm">Start a scan</ButtonLink>}
              >
                Run a scan and press Save. Every saved ear shows up here.
              </EmptyState>
            ) : (
              <EmptyState icon={<MdSearch />} title="No sessions match">Try another filename, device or filter.</EmptyState>
            )
          )}

          {shown.length > 0 && (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/50 text-xs text-on-surface-variant">
                      <th className="px-5 py-3 font-medium">Session</th>
                      <th className="px-5 py-3 font-medium">Saved at</th>
                      <th className="px-5 py-3 font-medium">Ear</th>
                      <th className="px-5 py-3 font-medium text-right">Responses</th>
                      <th className="px-5 py-3 font-medium">Result</th>
                      <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/50">
                    {shown.map(s => (
                      <tr key={s.filename} className="hover:bg-surface-container-low/60">
                        <td className="px-5 py-3">
                          <p className="text-xs font-medium font-mono text-on-surface">{s.filename}</p>
                          {s.device && <p className="text-xs text-on-surface-variant font-mono">{s.device}</p>}
                        </td>
                        <td className="px-5 py-3 text-on-surface-variant whitespace-nowrap">{new Date(s.saved_at).toLocaleString()}</td>
                        <td className="px-5 py-3 text-on-surface-variant whitespace-nowrap">{s.ear ? (s.ear === "left" ? "Left" : "Right") : "—"}{s.stim_db ? `, ${s.stim_db} dB` : ""}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{s.trial_count.toLocaleString()}</td>
                        <td className="px-5 py-3"><OutcomeChip outcome={outcomeOf(s)} /></td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <ButtonLink href={`/results?file=${encodeURIComponent(s.filename)}`} variant="ghost" size="sm">View</ButtonLink>
                          <Button variant="ghost" size="sm" onClick={() => download(s.filename)} disabled={downloading === s.filename}>
                            {downloading === s.filename ? "…" : "JSON"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <ul className="md:hidden divide-y divide-outline-variant/50">
                {shown.map(s => (
                  <li key={s.filename}>
                    <Link href={`/results?file=${encodeURIComponent(s.filename)}`} className="flex items-start justify-between gap-3 px-4 py-3.5 active:bg-surface-container-low">
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-medium font-mono break-all text-on-surface">{s.filename}</p>
                        <p className="text-xs text-on-surface-variant">
                          {new Date(s.saved_at).toLocaleString()}
                          {s.ear && `, ${s.ear === "left" ? "left" : "right"} ear`}
                        </p>
                        <p className="text-xs text-on-surface-variant tabular-nums">{s.trial_count.toLocaleString()} responses</p>
                      </div>
                      <OutcomeChip outcome={outcomeOf(s)} />
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="px-5 py-3 border-t border-outline-variant/50 flex items-center justify-between text-xs text-on-surface-variant">
                <span>Showing {shown.length} of {filtered.length}</span>
                {shown.length < filtered.length && (
                  <Button variant="ghost" size="sm" onClick={() => setLimit(l => l + PAGE)}>Load more</Button>
                )}
              </div>
            </>
          )}
        </section>

        <Footer />
      </Page>
    </>
  );
}
