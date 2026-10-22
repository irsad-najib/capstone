"use client";
import { useEffect, useRef, type DependencyList } from "react";

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, color: (token: string) => string) => void;

/** Baca token warna Tailwind (--color-*) supaya canvas ikut tema terang/gelap. */
function tokenReader(): (token: string) => string {
  const style = getComputedStyle(document.documentElement);
  return (token: string) => style.getPropertyValue(`--color-${token}`).trim() || "#888";
}

/**
 * Canvas yang digambar ulang saat deps berubah, ukuran elemen berubah,
 * atau tema (data-theme / prefers-color-scheme) berubah.
 */
export function useCanvas(draw: DrawFn, deps: DependencyList) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);

  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h, tokenReader());
    };
    render();

    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    const mo = new MutationObserver(render);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", render);
    return () => { ro.disconnect(); mo.disconnect(); mq.removeEventListener("change", render); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

/** Batas sumbu "rapi" (1, 2, 5 × 10^n) yang mencakup v. */
export function niceCeil(v: number): number {
  if (v <= 0 || !Number.isFinite(v)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function fmtUv(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
