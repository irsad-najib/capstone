"use client";

import { useEffect } from "react";
import { SidebarProvider } from "@/contexts/SidebarContext";
import NotificationWatcher from "@/components/NotificationWatcher";
import { useSettings } from "@/lib/settings";

/** data-theme di <html>: "light"/"dark" memaksa tema, tanpa atribut = ikut sistem. */
function ThemeSync() {
  const { theme } = useSettings();
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
  }, [theme]);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ThemeSync />
      <NotificationWatcher />
      {children}
    </SidebarProvider>
  );
}
