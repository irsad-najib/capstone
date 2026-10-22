"use client";

/**
 * Generic data-fetching hook backed by the Go API.
 * Handles loading / error states; refetches on the given interval (ms)
 * and whenever the backend URL in Settings changes.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useBackend(api.health, 5000);
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSettings } from "@/lib/settings";

interface State<T> {
  data: T | null;
  loading: boolean; // true hanya sampai respons pertama
  error: string | null;
}

export function useBackend<T>(
  fetcher: () => Promise<T>,
  intervalMs = 0,        // 0 = fetch once, >0 = poll
): State<T> & { refetch: () => void } {
  const [state, setState] = useState<State<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const { backendUrl } = useSettings();

  const fetcherRef = useRef(fetcher);

  const run = useCallback(async () => {
    try {
      const data = await fetcherRef.current();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState(s => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Unknown error",
      }));
    }
  }, []);

  useEffect(() => {
    // fetcher ikut deps supaya fetcher baru (mis. filename berubah) langsung dipakai.
    // Pemanggil wajib memberi fetcher yang stabil (fungsi modul atau useCallback).
    fetcherRef.current = fetcher;
    const first = setTimeout(run, 0);
    if (intervalMs > 0) {
      const id = setInterval(run, intervalMs);
      return () => { clearTimeout(first); clearInterval(id); };
    }
    return () => clearTimeout(first);
  }, [run, intervalMs, backendUrl, fetcher]);

  return { ...state, refetch: run };
}
