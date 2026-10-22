import type { ReactNode } from "react";
import { MdCloudOff } from "react-icons/md";
import { OUTCOME_INFO, type Outcome } from "@/lib/abr";

/** Chip hasil: selalu kata + ikon, tidak hanya warna. */
export function OutcomeChip({ outcome, size = "sm" }: { outcome: Outcome; size?: "sm" | "md" }) {
  const info = OUTCOME_INFO[outcome];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold whitespace-nowrap ${info.chip} ${
        size === "md" ? "px-3 py-1 text-xs" : "px-2.5 py-0.5 text-[11px]"
      }`}
    >
      <span aria-hidden="true">{info.icon}</span>
      {info.label}
    </span>
  );
}

export function StatusDot({ ok, pulse = false }: { ok: boolean | null; pulse?: boolean }) {
  const cls = ok == null ? "bg-outline-variant" : ok ? "bg-secondary" : "bg-error";
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls} ${pulse && ok ? "animate-pulse motion-reduce:animate-none" : ""}`} />;
}

export function Card({ title, icon, action, children, className = "" }: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-surface-container-lowest border border-outline-variant rounded-2xl ${className}`}>
      {(title || action) && (
        <header className="px-5 py-4 flex items-center justify-between gap-3 border-b border-outline-variant/60">
          <h2 className="text-base font-semibold text-primary flex items-center gap-2">{icon}{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function OfflineBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-error/30 bg-error-container/60 px-4 py-3 text-sm text-on-error-container" role="alert">
      <MdCloudOff className="text-xl shrink-0" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="min-h-9 px-3 rounded-lg bg-error text-on-error text-xs font-bold hover:opacity-90">
          Retry
        </button>
      )}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="py-6 mt-4 border-t border-outline-variant/60 text-xs text-on-surface-variant print:hidden">
      Neurosound · Capstone C-251 · Research prototype — not for clinical diagnosis
    </footer>
  );
}
