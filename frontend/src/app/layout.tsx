import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: {
    default: "Neurosound Clinical",
    template: "%s | Neurosound",
  },
  description: "ABR hearing screening and EEG diagnostic platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface text-on-surface antialiased">
        <Providers>
          <Sidebar />
          <div className="lg:ml-64 pb-16 lg:pb-0 min-h-screen">
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
