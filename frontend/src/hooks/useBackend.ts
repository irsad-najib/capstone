"use client";

/**
 * Generic data-fetching hook backed by the Go API.
 * Handles loading / error states; refetches on the given interval (ms).
 *
 * Usage:
 *   const { data, loading, error, refetch } = useBackend(api.health, 5000);
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface State<T> {
  data: T | null;
  loading: boolean;
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

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
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
    run();
    if (intervalMs > 0) {
      const id = setInterval(run, intervalMs);
      return () => clearInterval(id);
    }
  }, [run, intervalMs]);

  return { ...state, refetch: run };
}
