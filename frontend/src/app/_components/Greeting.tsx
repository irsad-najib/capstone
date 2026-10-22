"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { MdPlayCircle } from "react-icons/md";

// Tanggal hanya di klien supaya tidak beda dengan HTML hasil prerender.
const subscribe = () => () => {};
const getNow = () => new Date().toDateString();

export default function Greeting() {
  const today = useSyncExternalStore(subscribe, getNow, () => "");
  const hour = today ? new Date().getHours() : 12;
  const greet = hour < 11 ? "Good morning" : hour < 15 ? "Good afternoon" : hour < 19 ? "Good evening" : "Good night";

  return (
    <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h2 className="text-3xl md:text-4xl font-bold text-primary tracking-tight">{greet}</h2>
        <p className="text-sm text-on-surface-variant mt-1">
          {today ? new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : " "}
        </p>
      </div>
      <Link href="/scan" className="min-h-11 w-fit flex items-center gap-2 bg-secondary text-on-secondary px-5 rounded-lg text-sm font-bold hover:opacity-90">
        <MdPlayCircle className="text-xl" />Start new scan
      </Link>
    </section>
  );
}
