"use client";

import { createElement, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import MenuButton from "@/components/MenuButton";
import { iconFor } from "@/lib/nav";

/**
 * TopBar — header halaman, menempel di atas dan bergeser di kanan sidebar
 * desktop (lebar mengikuti --sidebar-w). Ikon judul sama dengan ikon menu di sidebar.
 */
interface TopBarProps {
  title: ReactNode;
  actions?: ReactNode;
}

export default function TopBar({ title, actions }: TopBarProps) {
  const icon = createElement(iconFor(usePathname()), { className: "text-[22px]" });
  return (
    <header className="topbar fixed top-0 left-0 lg:left-(--sidebar-w) right-0 z-40 h-16 flex items-center justify-between gap-4 px-4 md:px-8 lg:px-10 bg-surface/85 backdrop-blur-xl border-b border-outline-variant/60 transition-[left] duration-300 motion-reduce:transition-none">
      <div className="flex items-center gap-3 min-w-0">
        <MenuButton />
        <span className="flex items-center shrink-0 text-on-surface-variant" aria-hidden="true">
          {icon}
        </span>
        <h1 className="text-lg md:text-xl font-semibold tracking-tight text-on-surface truncate">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
