"use client";

import { MdMenu } from "react-icons/md";
import { useSidebar } from "@/contexts/SidebarContext";

export default function MenuButton({ className }: { className?: string }) {
  const { toggle } = useSidebar();
  return (
    <button
      onClick={toggle}
      className={`lg:hidden p-2 rounded-full hover:bg-surface-container-low ${className ?? ""}`}
    >
      <MdMenu className="text-2xl" />
    </button>
  );
}
