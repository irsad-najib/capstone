"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

/** Mobile-only bottom nav — hidden on lg+ screens. */
export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 lg:hidden flex justify-around items-center px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/60 print:hidden">
      {NAV_ITEMS.map(({ href, icon: Icon, short: label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`min-h-12 min-w-14 flex flex-col items-center justify-center gap-0.5 px-2 py-1 transition-colors ${
              isActive ? "text-on-surface" : "text-on-surface-variant"
            }`}
          >
            <span className={`flex items-center justify-center h-7 w-12 rounded-full transition-colors ${isActive ? "bg-secondary-container text-on-secondary-container" : ""}`}>
              <Icon className="text-[22px]" />
            </span>
            <span className={`text-[11px] ${isActive ? "font-semibold" : "font-medium"}`}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
