import type { Metadata } from "next";
import TopBar from "@/components/TopBar";
import { Footer, Page } from "@/components/ui";
import Greeting from "./_components/Greeting";
import DashboardMetrics from "./_components/DashboardMetrics";
import SystemMonitor from "./_components/SystemMonitor";
import RecentActivity from "./_components/RecentActivity";
import ScanSummaryPanel from "./_components/ScanSummaryPanel";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <TopBar title="Dashboard" />

      <Page>
        <Greeting />
        <DashboardMetrics />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><ScanSummaryPanel /></div>
          <SystemMonitor />
        </div>
        <RecentActivity />
        <Footer />
      </Page>
    </>
  );
}
