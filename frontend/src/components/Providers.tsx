"use client";

import { SidebarProvider } from "@/contexts/SidebarContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>;
}
