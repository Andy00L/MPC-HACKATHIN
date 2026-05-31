/**
 * hooks/useLedgerData.ts
 * Populates the overview the Story/Ledger pages show. There is no single overview
 * endpoint, so this derives it from two INDEPENDENT channels run on mount:
 *   1. getViolations()  — deterministic; the flag list, repeat offenders, flag count,
 *      and honest dataset totals. Needs no Gemini key, so it (almost) always succeeds.
 *   2. a few seed questions through askData() — the headline charts (category share,
 *      top vendors, spend-over-time). These require GEMINI_API_KEY and may fail; if they
 *      do, the violations half still renders and the summary shows a soft error.
 * Edge cases: empty dataset (zeros, empty arrays), one failed channel (degrade, show what
 * loaded), all-zero categories. Nothing here throws — every call returns an ApiResult.
 */
"use client";

import { useEffect, useState } from "react";
import type { Violation } from "@/lib/contract";
import { getOverview, getViolations } from "@/lib/api/client";
import type { ChartSeriesPoint } from "@/components/ledger/charts";

export interface LedgerData {
  loading: boolean; // the violations backbone is in flight
  summaryLoading: boolean; // the Gemini seed questions are in flight
  violationsError: string | null;
  summaryError: string | null;
  // Overview (violations route)
  violations: Violation[];
  repeatOffenders: { merchant: string; count: number }[];
  flagCount: number;
  transactionCount: number;
  // Headline numbers / charts (seed questions)
  totalSpend: number | null;
  categoryShare: ChartSeriesPoint[];
  topVendors: ChartSeriesPoint[];
  trend: ChartSeriesPoint[];
}

const INITIAL: LedgerData = {
  loading: true,
  summaryLoading: true,
  violationsError: null,
  summaryError: null,
  violations: [],
  repeatOffenders: [],
  flagCount: 0,
  transactionCount: 0,
  totalSpend: null,
  categoryShare: [],
  topVendors: [],
  trend: [],
};


export function useLedgerData(): LedgerData {
  const [state, setState] = useState<LedgerData>(INITIAL);

  useEffect(() => {
    // `alive` guards against setState after unmount (e.g. fast nav away during fetch).
    let alive = true;

    // Channel 1 — violations. Applied as soon as it resolves; clears `loading`.
    getViolations().then((result) => {
      if (!alive) return;
      if (result.ok) {
        // OVER_PREAUTH is a compliance receipt-tracking rule, not a suspicious flag.
        // It fires on ~2,000+ routine fleet charges and must not inflate the headline count.
        // Filter it here so every consumer of data.violations and data.flagCount agrees.
        const suspicious = result.data.violations.filter((v) => v.ruleId !== "OVER_PREAUTH");
        setState((prev) => ({
          ...prev,
          loading: false,
          violationsError: null,
          violations: suspicious,
          repeatOffenders: result.data.repeatOffenders,
          flagCount: suspicious.length,
          transactionCount: result.data.transactionCount ?? 0,
        }));
      } else {
        // Aborted is not a real error; for an actual failure, surface it but still clear
        // loading so the book renders (degraded) rather than spinning forever.
        setState((prev) => ({ ...prev, loading: false, violationsError: result.aborted ? null : result.error }));
      }
    });

    // Channel 2 — spend aggregations from the deterministic overview route.
    // No Gemini call needed; computed directly from dataset.json on the server.
    getOverview().then((result) => {
      if (!alive) return;
      if (result.ok) {
        setState((prev) => ({
          ...prev,
          summaryLoading: false,
          summaryError: null,
          totalSpend: result.data.totalSpend,
          categoryShare: result.data.categoryShare,
          trend: result.data.trend,
          topVendors: result.data.topVendors,
        }));
      } else {
        setState((prev) => ({ ...prev, summaryLoading: false, summaryError: result.error }));
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  return state;
}
