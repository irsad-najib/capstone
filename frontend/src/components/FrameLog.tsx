"use client";
import { useEffect, useRef } from "react";
import type { FrameLogEntry } from "@/hooks/useABRStream";

interface Props {
  frames: FrameLogEntry[];
}

export default function FrameLog({ frames }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frames]);

  return (
    <div className="rounded overflow-hidden border border-[#30363d]" style={{ background: "#161b22" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[#30363d]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e]">
          Frame JSON per Paket WebSocket
        </span>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border border-[#d29922]" style={{ background: "rgba(210,153,34,0.18)" }} />
            <span className="text-[#d29922]">stim (s:1)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border border-[rgba(88,166,255,0.25)]" style={{ background: "rgba(88,166,255,0.08)" }} />
            <span className="text-[#8b949e]">normal (s:0)</span>
          </span>
        </div>
      </div>

      {/* Rows */}
      <div
        ref={scrollRef}
        className="overflow-y-auto flex flex-col gap-0.5 p-2"
        style={{ height: 220, fontFamily: "'Courier New', monospace", fontSize: 11.5 }}
      >
        {frames.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#8b949e] text-xs">
            Menunggu data dari ESP32…
          </div>
        )}
        {frames.map((f, i) => {
          const isStim  = f.stim;
          const mvDisp  = (f.mv >= 0 ? "+" : "") + f.mv.toFixed(3);
          const json    = `{"t":${f.ts},"r":${f.raw},"s":${isStim ? 1 : 0}}`;
          return (
            <div
              key={i}
              className="grid items-center rounded px-2.5 py-1.5"
              style={{
                gridTemplateColumns: "44px 130px 1fr",
                gap: 8,
                background:   isStim ? "rgba(210,153,34,0.18)" : "rgba(88,166,255,0.05)",
                border:       `1px solid ${isStim ? "#d29922" : "rgba(88,166,255,0.12)"}`,
                boxShadow:    isStim ? "0 0 8px rgba(210,153,34,0.15)" : "none",
              }}
            >
              {/* Index */}
              <span className="text-right text-[10.5px]" style={{ color: "#8b949e" }}>
                #{String(f.idx).padStart(5, "0")}
              </span>

              {/* t + r + s */}
              <span>
                <span style={{ color: "#8b949e" }}>t:</span>
                <span style={{ color: "#ffa657" }}>{f.ts}</span>
                <span style={{ color: "#8b949e" }}> r:</span>
                <span style={{ color: f.mv >= 0 ? "#3fb950" : "#f85149" }}>{mvDisp}mV</span>
                <span style={{ color: "#8b949e" }}> s:</span>
                {isStim
                  ? <span style={{ color: "#d29922", fontWeight: 800 }}>1 <span style={{ padding: "1px 4px", background: "rgba(210,153,34,0.3)", border: "1px solid #d29922", borderRadius: 3, fontSize: 10 }}>🔔 STIM</span></span>
                  : <span style={{ color: "#8b949e" }}>0</span>
                }
              </span>

              {/* JSON compact */}
              <span style={{ color: isStim ? "#d29922" : "#79c0ff" }}>
                <span style={{ color: "#8b949e" }}>[TX→WS] </span>
                {json}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
