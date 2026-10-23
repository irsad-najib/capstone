import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { MdCloudOff } from "react-icons/md";
import { OUTCOME_INFO, type Outcome } from "@/lib/abr";

/* ── Layout ──────────────────────────────────────────────────────── */

/** Isi halaman di bawah TopBar. `narrow` untuk halaman formulir (Settings). */
export function Page({ children, narrow = false, className = "" }: { children: ReactNode; narrow?: boolean; className?: string }) {
  return (
    <main className={`pt-[5.5rem] px-4 md:px-8 lg:px-10 pb-12 mx-auto space-y-6 ${narrow ? "max-w-3xl" : "max-w-7xl"} ${className}`}>
      {children}
    </main>
  );
}

export function Card({ title, description, action, children, className = "", flush = false }: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Tanpa padding isi, untuk tabel / list yang menempel ke tepi kartu. */
  flush?: boolean;
}) {
  const head = title || action;
  return (
    <section className={`bg-surface-container-lowest border border-outline-variant/60 rounded-2xl min-w-0 ${className}`}>
      {head && (
        <header className="px-5 pt-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (typeof title === "string"
              ? <h2 className="text-[15px] font-semibold text-on-surface">{title}</h2>
              : title)}
            {description && <p className="text-sm text-on-surface-variant mt-0.5">{description}</p>}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={flush ? (head ? "pt-4" : "") : head ? "px-5 pb-5 pt-4" : "p-5"}>{children}</div>
    </section>
  );
}

/* ── Buttons ─────────────────────────────────────────────────────── */

type Variant = "primary" | "secondary" | "danger" | "outline" | "ghost";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:   "bg-primary text-on-primary hover:bg-primary/90",
  secondary: "bg-secondary text-on-secondary hover:bg-secondary/90",
  danger:    "bg-error text-on-error hover:bg-error/90",
  outline:   "border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low",
  ghost:     "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
};
const SIZES: Record<Size, string> = {
  sm:   "h-8 px-3 text-xs",
  md:   "h-10 px-4 text-sm",
  icon: "h-10 w-10 text-xl",
};

export function buttonClass(variant: Variant = "outline", size: Size = "md", className = "") {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors
    disabled:opacity-45 disabled:pointer-events-none
    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
    [&>svg]:text-[1.15em] [&>svg]:shrink-0 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

export function Button({ variant, size, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

/* ── Status ──────────────────────────────────────────────────────── */

type Tone = "success" | "warning" | "error" | "neutral" | "live";
const TONES: Record<Tone, string> = {
  success: "bg-secondary-container text-on-secondary-container",
  warning: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  error:   "bg-error-container text-on-error-container",
  neutral: "bg-surface-container-high text-on-surface-variant",
  live:    "bg-error text-on-error",
};

export function Badge({ tone = "neutral", pulse = false, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONES[tone]}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current pulse-red" />}
      {children}
    </span>
  );
}

/** Chip hasil: selalu kata + ikon, tidak hanya warna. */
export function OutcomeChip({ outcome, size = "sm" }: { outcome: Outcome; size?: "sm" | "md" }) {
  const info = OUTCOME_INFO[outcome];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${info.chip} ${
        size === "md" ? "h-7 px-3 text-sm" : "h-6 px-2.5 text-xs"
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

export function OfflineBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-error-container px-4 py-3 text-sm text-on-error-container" role="alert">
      <MdCloudOff className="text-xl shrink-0" />
      <p className="flex-1">{message}</p>
      {onRetry && <Button variant="danger" size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "info" | "success"; children: ReactNode }) {
  const cls = kind === "error" ? "bg-error-container text-on-error-container"
    : kind === "success" ? "bg-secondary-container text-on-secondary-container"
    : "bg-surface-container text-on-surface";
  return <p role={kind === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</p>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-10 px-4">
      {icon && <div className="text-3xl text-outline mb-1">{icon}</div>}
      <p className="text-sm font-semibold text-on-surface">{title}</p>
      {children && <p className="text-sm text-on-surface-variant max-w-sm">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ── Data display ────────────────────────────────────────────────── */

/** Angka kecil berlabel, dipakai di grid statistik. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-surface-container-low px-3 py-2.5 min-w-0">
      <dt className="text-xs text-on-surface-variant truncate">{label}</dt>
      <dd className={`mt-0.5 font-mono text-sm font-medium tabular-nums truncate ${tone === "good" ? "text-secondary" : tone === "bad" ? "text-error" : "text-on-surface"}`}>
        {value}
        {tone && <span className="sr-only">{tone === "good" ? " (good)" : " (weak)"}</span>}
      </dd>
    </div>
  );
}

/** Baris label–nilai di dalam <dl className="divide-y …">. */
export function Row({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="text-on-surface-variant shrink-0">{label}</dt>
      <dd className={`text-right text-on-surface min-w-0 ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

/* ── Form controls ───────────────────────────────────────────────── */

export const inputClass =
  "w-full h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface placeholder:text-outline outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50";

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-on-surface">{label}</label>
      {children}
      {hint && <p className="text-xs text-on-surface-variant">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-on-surface">{label}</p>
        {hint && <p className="text-xs text-on-surface-variant mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${checked ? "bg-secondary" : "bg-outline-variant"}`}
      >
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-surface-container-lowest shadow-sm transition-transform motion-reduce:transition-none ${checked ? "translate-x-5.5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

/** Pilihan tunggal berbentuk track. Dipakai untuk tab, telinga, rentang, tema, dsb. */
export function Segmented<T extends string | number>({ options, value, onChange, label, disabled, size = "md", className = "" }: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="group" aria-label={label}
      className={`inline-flex items-center gap-0.5 rounded-lg bg-surface-container-low p-0.5 ${disabled ? "opacity-50 pointer-events-none" : ""} ${className}`}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary
            ${size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-sm"}
            ${value === o.value
              ? "bg-surface-container-lowest text-on-surface shadow-sm ring-1 ring-outline-variant/60"
              : "text-on-surface-variant hover:text-on-surface"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="pt-6 text-xs text-on-surface-variant print:hidden">
      NeuroSound, Capstone C-251. Research prototype, not for clinical diagnosis.
    </footer>
  );
}
