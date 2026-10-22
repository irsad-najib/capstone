"use client";
import { useEffect, useRef } from "react";
import type { PacketLogEntry } from "@/hooks/useABRStream";

interface Props {
  packets: PacketLogEntry[];
}

/** Log paket raw stream (SSE tiap 200 ms) untuk debugging aliran data. */
export default function FrameLog({ packets }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [packets]);

  return (
    <div
      ref={scrollRef}
      className="h-56 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-low font-mono text-[11px] leading-5"
    >
      {packets.length === 0 ? (
        <p className="h-full flex items-center justify-center text-on-surface-variant">No packets yet.</p>
      ) : (
        <table className="w-full tabular-nums">
          <thead className="sticky top-0 bg-surface-container text-on-surface-variant text-left">
            <tr>
              <th className="px-3 py-1 font-semibold">#</th>
              <th className="px-3 py-1 font-semibold">Time</th>
              <th className="px-3 py-1 font-semibold text-right">Samples</th>
              <th className="px-3 py-1 font-semibold text-right">Stim</th>
              <th className="px-3 py-1 font-semibold text-right">Ch 1 (µV)</th>
              <th className="px-3 py-1 font-semibold text-right">Ch 2 (µV)</th>
            </tr>
          </thead>
          <tbody>
            {packets.map(p => (
              <tr key={p.seq} className={p.stims ? "bg-tertiary-fixed/40" : ""}>
                <td className="px-3 text-on-surface-variant">{p.seq}</td>
                <td className="px-3">{new Date(p.at).toLocaleTimeString([], { hour12: false })}.{String(p.at % 1000).padStart(3, "0")}</td>
                <td className="px-3 text-right">{p.samples}</td>
                <td className="px-3 text-right">{p.stims}</td>
                <td className="px-3 text-right">{p.ch1.toFixed(2)}</td>
                <td className="px-3 text-right">{p.ch2.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
