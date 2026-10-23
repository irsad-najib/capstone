import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import Providers from "@/components/Providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono  = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const DESCRIPTION = "Wearable EEG untuk skrining gangguan pendengaran berbasis Auditory Brainstem Response (ABR). Research prototype, Capstone C-251.";

// Ikon, gambar Open Graph dan Twitter diambil dari file di app/ (icon.png,
// apple-icon.png, opengraph-image.png, twitter-image.png). metadataBase dipakai
// untuk URL absolut gambar preview; isi NEXT_PUBLIC_SITE_URL dengan domain frontend.
export const metadata: Metadata = {
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  title: {
    default: "NeuroSound",
    template: "%s | NeuroSound",
  },
  description: DESCRIPTION,
  applicationName: "NeuroSound",
  openGraph: {
    type: "website",
    siteName: "NeuroSound",
    title: "NeuroSound",
    description: DESCRIPTION,
    locale: "id_ID",
  },
  twitter: {
    card: "summary_large_image",
    title: "NeuroSound",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9fb" },
    { media: "(prefers-color-scheme: dark)",  color: "#121315" },
  ],
};

// Pasang data-theme dan data-sidebar sebelum paint supaya tidak berkedip.
const themeScript = `try{var d=document.documentElement,t=JSON.parse(localStorage.getItem("neurosound.settings")||"{}").theme;if(t==="light"||t==="dark")d.setAttribute("data-theme",t);if(localStorage.getItem("neurosound.sidebar")==="collapsed")d.setAttribute("data-sidebar","collapsed")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-surface text-on-surface antialiased">
        <Providers>
          <Sidebar />
          <div className="lg:ml-(--sidebar-w) pb-16 lg:pb-0 min-h-screen print:ml-0 print:pb-0 transition-[margin] duration-300 motion-reduce:transition-none">
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
