import type { Metadata } from "next";

// Halaman admin sengaja tidak ada di navigasi; buka langsung lewat /admin.
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
