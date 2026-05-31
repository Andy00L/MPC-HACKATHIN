/**
 * hooks/useReports.ts
 * Lazily fetches /api/reports (the trip-clustered expense reports) the first time the Trips
 * chapter is opened. The route is deterministic and cheap server-side, but the fetch is
 * still lazy so the page does not pull it until it is needed. Never throws (getReports
 * returns an ApiResult); a failure surfaces as `error` and the chapter degrades gracefully.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpenseReport } from "@/lib/contract";
import { getReports } from "@/lib/api/client";

export interface ReportsState {
  reports: ExpenseReport[];
  loading: boolean;
  error: string | null;
}

export function useReports(active: boolean): ReportsState {
  const [reports, setReports] = useState<ExpenseReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!active || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    getReports().then((result) => {
      if (result.ok) {
        setReports(result.data.reports);
        setError(null);
      } else if (!result.aborted) {
        setError(result.error);
      }
      setLoading(false);
    });
  }, [active]);

  return { reports, loading, error };
}
