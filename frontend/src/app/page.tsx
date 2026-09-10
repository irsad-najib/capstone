import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import MenuButton from "@/components/MenuButton";
import DashboardMetrics from "./_components/DashboardMetrics";
import RecentActivity from "./_components/RecentActivity";
import ScanSummaryPanel from "./_components/ScanSummaryPanel";
import {
  MdIosShare,
  MdNotifications,
  MdSearch,
  MdSettings,
  MdVerifiedUser,
} from "react-icons/md";

export const metadata: Metadata = { title: "Dashboard" };

const systemStats = [
  { label: "Sensor Calibration", pct: 98, color: "bg-secondary",         textColor: "text-secondary"    },
  { label: "Cloud Storage",      pct: 42, color: "bg-primary",           textColor: "text-on-surface"   },
  { label: "Battery Status",     pct: 81, color: "bg-primary-container", textColor: "text-primary"      },
];

export default function DashboardPage() {
  return (
    <>
      <TopBar
        left={
          <>
            <MenuButton />
            <div className="hidden md:flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-xl border border-outline-variant w-80 focus-within:border-primary transition-colors">
              <MdSearch className="text-on-surface-variant text-[20px]" />
              <input className="bg-transparent outline-none text-sm text-on-surface w-full" placeholder="Search records..." />
            </div>
          </>
        }
        right={
          <>
            <button className="relative w-9 h-9 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors">
              <MdNotifications className="text-xl" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-error rounded-full border-2 border-surface" />
            </button>
            <Link
              href="/settings"
              className="w-9 h-9 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors"
              title="Settings"
            >
              <MdSettings className="text-xl" />
            </Link>
          </>
        }
      />

      <main className="pt-20 px-4 md:px-12 pb-10 max-w-7xl mx-auto space-y-8">

        {/* ── Welcome ─────────────────────────────────────────── */}
        <section>
          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-primary tracking-tight">
              Clinician Dashboard
            </h2>
            <p className="text-sm text-on-surface-variant mt-1">
              Real-time ABR screening system status
            </p>
          </div>
        </section>

        {/* ── Metric cards (client, polls backend) ─────────────── */}
        <DashboardMetrics />

        {/* ── Hero + System monitoring ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <div className="lg:col-span-2">
            <ScanSummaryPanel />
          </div>

          {/* System monitoring */}
          <div className="bg-white rounded-2xl p-6 space-y-6 border border-outline-variant/60 shadow-sm">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-primary">System Monitoring</h4>
              <MdVerifiedUser className="text-secondary text-xl" />
            </div>
            <div className="space-y-5">
              {systemStats.map(({ label, pct, color, textColor }) => (
                <div key={label} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-on-surface-variant">{label}</span>
                    <span className={textColor}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                    <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full py-3 border border-outline-variant text-on-surface rounded-xl text-xs font-semibold hover:bg-surface-container-low transition-all flex justify-center items-center gap-2">
              <MdIosShare className="text-[18px]" />
              Export Session Logs
            </button>
          </div>
        </div>

        {/* ── Recent sessions (client, fetches backend) ─────────── */}
        <RecentActivity />

        {/* ── Footer ──────────────────────────────────────────── */}
        <footer className="flex flex-col md:flex-row justify-between items-center py-6 border-t border-outline-variant/30 text-xs text-on-surface-variant/70">
          <p>© 2024 Neurosound Medical Systems. FDA Cleared Diagnostic Device.</p>
          <div className="flex gap-6 mt-3 md:mt-0">
            <a href="#" className="hover:text-primary transition-colors">Support</a>
            <a href="#" className="hover:text-primary transition-colors">Compliance</a>
          </div>
        </footer>
      </main>
    </>
  );
}
