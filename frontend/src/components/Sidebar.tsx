"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MdClose,
  MdGridView,
  MdHistory,
  MdMonitorHeart,
  MdSensors,
  MdSettingsApplications,
} from "react-icons/md";
import { useSidebar } from "@/contexts/SidebarContext";

const navItems = [
  { href: "/",        icon: MdGridView,     label: "Dashboard"     },
  { href: "/scan",    icon: MdMonitorHeart, label: "Start Scan"    },
  { href: "/records", icon: MdHistory,      label: "History"       },
  { href: "/device",  icon: MdSensors,      label: "Device Status" },
  { href: "/settings", icon: MdSettingsApplications, label: "Settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { open, close } = useSidebar();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed left-0 top-0 h-full w-64 flex flex-col bg-primary text-white border-r border-white/5 z-50
          transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        {/* Brand + close button */}
        <div className="px-6 py-6 mb-2 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#cde5ff] tracking-tight">Neurosound</h1>
            <p className="text-xs text-white/50 mt-0.5">Clinical Portal</p>
          </div>
          <button
            onClick={close}
            className="lg:hidden p-1 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <MdClose className="text-xl" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto hide-scrollbar">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={close}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-semibold
                  transition-all duration-100 active:scale-95
                  ${isActive
                    ? "bg-primary-container text-[#cde5ff]"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
              >
                <Icon className="text-[20px]" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
