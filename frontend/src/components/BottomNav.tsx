"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MdGridView, MdHistory, MdMonitorHeart, MdSensors, MdSettingsApplications } from "react-icons/md";

const navItems = [
  { href: "/",        icon: MdGridView,     label: "Home"    },
  { href: "/scan",    icon: MdMonitorHeart, label: "Scan"    },
  { href: "/records", icon: MdHistory,      label: "History" },
  { href: "/device",  icon: MdSensors,      label: "Device"  },
  { href: "/settings", icon: MdSettingsApplications, label: "Settings" },
];

/** Mobile-only bottom nav — hidden on lg+ screens. */
export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden flex justify-around items-center px-2 py-2 bg-white/95 backdrop-blur-xl border-t border-outline-variant shadow-lg">
      {navItems.map(({ href, icon: Icon, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${
              isActive ? "text-primary" : "text-on-surface-variant"
            }`}
          >
            {isActive ? (
              <span className="bg-secondary-container rounded-2xl px-3 py-1">
                <Icon className="text-[22px]" />
              </span>
            ) : (
              <Icon className="text-[22px]" />
            )}
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
