"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const SidebarCtx = createContext<{
  open: boolean;
  toggle: () => void;
  close: () => void;
}>({ open: false, toggle: () => {}, close: () => {} });

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SidebarCtx.Provider value={{ open, toggle: () => setOpen(v => !v), close: () => setOpen(false) }}>
      {children}
    </SidebarCtx.Provider>
  );
}

export const useSidebar = () => useContext(SidebarCtx);
