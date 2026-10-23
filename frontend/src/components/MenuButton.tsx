"use client";

import { MdMenu, MdMenuOpen } from "react-icons/md";
import { useSidebar } from "@/contexts/SidebarContext";

/** Mobile: buka drawer. Desktop (lg+): buka/tutup sidebar. */
export default function MenuButton({ className }: { className?: string }) {
  const { toggle, toggleCollapsed } = useSidebar();
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="Open menu"
        className={`lg:hidden -ml-2 h-10 w-10 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low ${className ?? ""}`}
      >
        <MdMenu className="text-2xl" />
      </button>
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label="Collapse or expand sidebar"
        title="Collapse or expand sidebar"
        className={`hidden lg:flex -ml-2 h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors ${className ?? ""}`}
      >
        <MdMenuOpen className="text-2xl collapsed:hidden" />
        <MdMenu className="text-2xl hidden collapsed:block" />
      </button>
    </>
  );
}
