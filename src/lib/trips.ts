/**
 * trips.ts
 * Groups spend into route reports using the date and geography the data actually
 * has. A trip is a run of charges close in time and dominant location. The data has
 * no employees, so a trip belongs to a route, not a person, which is honest for a
 * fleet card.
 */

import type { Transaction, ExpenseReport, Category } from "./contract";
import { spendOnly } from "./aggregate";
import { findViolations } from "./compliance";

const GAP_DAYS = 3; // a gap larger than this starts a new trip

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** The state that appears most often in a group, or "Unknown". */
function dominantState(txns: Transaction[]): string {
  const counts = new Map<string, number>();
  for (const t of txns) {
    if (t.state) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  }
  let best = "Unknown";
  let bestCount = 0;
  for (const [state, count] of counts) {
    if (count > bestCount) {
      best = state;
      bestCount = count;
    }
  }
  return best;
}

function totalsByCategory(txns: Transaction[]): { category: Category; total: number }[] {
  const totals = new Map<Category, number>();
  for (const t of txns) {
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

function buildReport(group: Transaction[], index: number): ExpenseReport {
  const sorted = [...group].sort((a, b) => (a.txnDate ?? "").localeCompare(b.txnDate ?? ""));
  const start = sorted[0].txnDate ?? "";
  const end = sorted[sorted.length - 1].txnDate ?? "";
  const region = dominantState(sorted);
  const total = sorted.reduce((sum, t) => sum + t.amount, 0);

  return {
    id: `report_${String(index + 1).padStart(3, "0")}`,
    label: `${region} run, ${start} to ${end}`,
    startDate: start,
    endDate: end,
    region,
    transactions: sorted,
    totalsByCategory: totalsByCategory(sorted),
    total,
    violations: findViolations(sorted), // policy checks on just this group
    narration: "",
  };
}

/**
 * Clusters real spend into trips. Walks transactions in date order and starts a new
 * trip when the gap exceeds GAP_DAYS or the dominant state changes. Transactions
 * with no date go into a single "undated" report rather than being dropped.
 */
export function buildReports(allTxns: Transaction[]): ExpenseReport[] {
  const spend = spendOnly(allTxns);
  const dated = spend.filter((t) => t.txnDate !== null).sort((a, b) => a.txnDate!.localeCompare(b.txnDate!));
  const undated = spend.filter((t) => t.txnDate === null);

  const reports: ExpenseReport[] = [];
  let current: Transaction[] = [];

  for (const t of dated) {
    if (current.length === 0) {
      current = [t];
      continue;
    }
    const prev = current[current.length - 1];
    const gap = daysBetween(prev.txnDate!, t.txnDate!);
    const stateChanged = t.state !== null && dominantState(current) !== t.state;

    if (gap > GAP_DAYS || stateChanged) {
      reports.push(buildReport(current, reports.length));
      current = [t];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) reports.push(buildReport(current, reports.length));

  if (undated.length > 0) {
    const r = buildReport(undated, reports.length);
    r.label = "Undated charges";
    reports.push(r);
  }

  return reports;
}
