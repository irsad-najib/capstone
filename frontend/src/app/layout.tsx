import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: {
    default: "Neurosound",
    template: "%s | Neurosound",
  },
  description: "ABR hearing screening research prototype (Capstone C-251)",
};

// Pasang data-theme sebelum paint supaya tema gelap tidak berkedip terang.
const themeScript = `try{var t=JSON.parse(localStorage.getItem("neurosound.settings")||"{}").theme;if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-surface text-on-surface antialiased">
        <Providers>
          <Sidebar />
          <div className="lg:ml-64 pb-16 lg:pb-0 min-h-screen print:ml-0 print:pb-0">
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
