"use client";

import { useSyncExternalStore } from "react";
import { MdPlayArrow } from "react-icons/md";
import { ButtonLink } from "@/components/ui";

// Tanggal hanya di klien supaya tidak beda dengan HTML hasil prerender.
const subscribe = () => () => {};
const getNow = () => new Date().toDateString();

export default function Greeting() {
  const today = useSyncExternalStore(subscribe, getNow, () => "");
  const hour = today ? new Date().getHours() : 12;
  const greet = hour < 11 ? "Good morning" : hour < 15 ? "Good afternoon" : hour < 19 ? "Good evening" : "Good night";

  return (
    <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-2">
      <div>
        <h2 className="text-2xl md:text-[28px] md:leading-9 font-semibold tracking-tight text-on-surface">{greet}</h2>
        <p className="text-sm text-on-surface-variant mt-1">
          {today ? new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : " "}
        </p>
      </div>
      <ButtonLink href="/scan" variant="secondary" className="w-fit">
        <MdPlayArrow />Start new scan
      </ButtonLink>
    </section>
  );
}
