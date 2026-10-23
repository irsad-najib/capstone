/**
 * Daftar halaman: dipakai Sidebar, BottomNav, dan ikon judul di TopBar
 * supaya ikon satu halaman selalu sama di semua tempat.
 */
import type { IconType } from "react-icons";
import {
  MdAdminPanelSettings,
  MdAssignment,
  MdGridView,
  MdHistory,
  MdMonitorHeart,
  MdSensors,
  MdSettingsApplications,
} from "react-icons/md";

export interface NavItem {
  href: string;
  icon: IconType;
  label: string;
  short: string; // label bottom nav mobile
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/",         icon: MdGridView,             label: "Dashboard",     short: "Home"     },
  { href: "/scan",     icon: MdMonitorHeart,         label: "Start Scan",    short: "Scan"     },
  { href: "/records",  icon: MdHistory,              label: "History",       short: "History"  },
  { href: "/device",   icon: MdSensors,              label: "Device Status", short: "Device"   },
  { href: "/settings", icon: MdSettingsApplications, label: "Settings",      short: "Settings" },
];

/** Halaman di luar navigasi utama. */
const EXTRA: Record<string, IconType> = {
  "/results": MdAssignment,
  "/admin":   MdAdminPanelSettings,
};

export function iconFor(pathname: string): IconType {
  if (EXTRA[pathname]) return EXTRA[pathname];
  return NAV_ITEMS.find(n => n.href !== "/" && pathname.startsWith(n.href))?.icon ?? MdGridView;
}
