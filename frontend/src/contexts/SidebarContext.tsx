"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * open      = drawer mobile terbuka.
 * collapsed = sidebar desktop menyempit jadi ikon saja. Disimpan sebagai
 *             data-sidebar="collapsed" di <html> (dipasang sebelum paint oleh
 *             skrip di layout.tsx) supaya tampilan langsung benar tanpa berkedip.
 */
const SidebarCtx = createContext<{
  open: boolean;
  toggle: () => void;
  close: () => void;
  toggleCollapsed: () => void;
}>({ open: false, toggle: () => {}, close: () => {}, toggleCollapsed: () => {} });

export const SIDEBAR_KEY = "neurosound.sidebar";

function toggleCollapsed() {
  const el = document.documentElement;
  const next = el.getAttribute("data-sidebar") === "collapsed" ? "expanded" : "collapsed";
  if (next === "collapsed") el.setAttribute("data-sidebar", "collapsed");
  else el.removeAttribute("data-sidebar");
  try { window.localStorage.setItem(SIDEBAR_KEY, next); } catch {}
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SidebarCtx.Provider value={{ open, toggle: () => setOpen(v => !v), close: () => setOpen(false), toggleCollapsed }}>
      {children}
    </SidebarCtx.Provider>
  );
}

export const useSidebar = () => useContext(SidebarCtx);
