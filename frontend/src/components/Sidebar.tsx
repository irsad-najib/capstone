"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MdClose } from "react-icons/md";
import { useSidebar } from "@/contexts/SidebarContext";
import { useBackend } from "@/hooks/useBackend";
import { api } from "@/lib/api";
import { NAV_ITEMS } from "@/lib/nav";
import { StatusDot } from "@/components/ui";

/* Saat sidebar desktop menyempit (data-sidebar="collapsed"), teks disembunyikan
   dan ikon ditaruh di tengah. Drawer mobile selalu tampil penuh. */
const hideWhenCollapsed = "lg:collapsed:hidden";

function ConnectionStatus() {
  const health  = useBackend(api.health, 10_000);
  const devices = useBackend(api.devices, 10_000);
  const online = health.data?.status === "ok" && !health.error;
  const ids = devices.data?.devices ?? [];
  const backendText = health.loading ? "Checking backend…" : online ? "Backend online" : "Backend offline";
  const deviceText = ids.length ? ids.join(", ") : "No device";

  return (
    <div className="mx-3 mb-4 rounded-xl bg-white/5 px-3 py-3 space-y-2 text-xs lg:collapsed:mx-auto lg:collapsed:px-0 lg:collapsed:w-10 lg:collapsed:flex lg:collapsed:flex-col lg:collapsed:items-center">
      <p className="flex items-center gap-2 text-white/80" title={backendText}>
        <StatusDot ok={health.loading ? null : online} />
        <span className={hideWhenCollapsed}>{backendText}</span>
      </p>
      <p className="flex items-center gap-2 text-white/60 min-w-0" title={deviceText}>
        <StatusDot ok={devices.loading ? null : ids.length > 0} />
        <span className={`font-mono truncate ${hideWhenCollapsed}`}>{deviceText}</span>
      </p>
    </div>
  );
}

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
          sidebar fixed left-0 top-0 h-full w-64 lg:w-(--sidebar-w) flex flex-col bg-sidebar text-white print:hidden z-50 overflow-hidden
          transition-[transform,width] duration-300 motion-reduce:transition-none
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        {/* Brand + close button */}
        <div className="relative h-16 px-12 flex items-center justify-center lg:collapsed:px-0">
          <Link href="/" onClick={close} className="flex items-center min-w-0" title="NeuroSound" aria-label="NeuroSound home">
            {/* Logo versi terang: navy diganti biru muda supaya terbaca di sidebar gelap. */}
            <Image src="/brand/neurosound-logo-light.png" alt="" width={1012} height={264} priority className={`h-9 w-auto ${hideWhenCollapsed}`} />
            <Image src="/brand/neurosound-mark-light.png" alt="" width={512} height={512} priority className="hidden lg:collapsed:block h-10 w-10" />
          </Link>
          <button
            type="button"
            onClick={close}
            className="lg:hidden absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <MdClose className="text-xl" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 pt-4 space-y-0.5 overflow-y-auto hide-scrollbar">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={close}
                title={label}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
                  lg:collapsed:justify-center lg:collapsed:px-0
                  focus-visible:outline-2 focus-visible:outline-primary-fixed
                  ${isActive
                    ? "bg-sidebar-active text-primary-fixed shadow-[inset_3px_0_0_#9dd2b5]"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
              >
                <Icon className="text-xl shrink-0" />
                <span className={hideWhenCollapsed}>{label}</span>
              </Link>
            );
          })}
        </nav>

        <ConnectionStatus />
      </aside>
    </>
  );
}
