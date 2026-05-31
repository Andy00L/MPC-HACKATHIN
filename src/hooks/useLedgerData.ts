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
import { askData, getViolations } from "@/lib/api/client";
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

// Turn a category slug ("permits_gov") into a readable label ("Permits Gov"). Generic —
// no hardcoded category list — so it survives new categories without edits.
function prettifyLabel(label: string): string {
  return label
    .split("_")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

export function useLedgerData(): LedgerData {
  const [state, setState] = useState<LedgerData>(INITIAL);

  useEffect(() => {
    // `alive` guards against setState after unmount (e.g. fast nav away during fetch).
    let alive = true;

    // Channel 1 — violations. Applied as soon as it resolves; clears `loading`.
    getViolations().then((result) => {
      if (!alive) return;
      if (result.ok) {
        setState((prev) => ({
          ...prev,
          loading: false,
          violationsError: null,
          violations: result.data.violations,
          repeatOffenders: result.data.repeatOffenders,
          flagCount: result.data.count,
          transactionCount: result.data.transactionCount ?? 0,
        }));
      } else {
        // Aborted is not a real error; for an actual failure, surface it but still clear
        // loading so the book renders (degraded) rather than spinning forever.
        setState((prev) => ({ ...prev, loading: false, violationsError: result.aborted ? null : result.error }));
      }
    });

    // Channel 2 — the headline summary via seed questions, run in parallel.
    Promise.all([
      askData("total spend grouped by category", ""),
      askData("top vendors by total spend", ""),
      askData("spend over time by month", ""),
    ]).then(([category, vendors, time]) => {
      if (!alive) return;
      // Each seed independently degrades to an empty series on failure.
      const categoryShare = category.ok
        ? category.data.chart.series.map((point) => ({ label: prettifyLabel(point.label), value: point.value }))
        : [];
      const topVendors = vendors.ok ? vendors.data.chart.series : [];
      const trend = time.ok ? time.data.chart.series : [];
      // Total spend = sum of the category slices (category spend sums to total spend).
      // Null when the category seed failed, so the UI can show "—" rather than a wrong 0.
      const totalSpend = category.ok ? categoryShare.reduce((sum, point) => sum + point.value, 0) : null;
      const anyFailed = !category.ok || !vendors.ok || !time.ok;
      setState((prev) => ({
        ...prev,
        summaryLoading: false,
        categoryShare,
        topVendors,
        trend,
        totalSpend,
        summaryError: anyFailed ? "The keeper could not read the summary (is GEMINI_API_KEY set?)." : null,
      }));
    });

    return () => {
      alive = false;
    };
  }, []);

  return state;
}
