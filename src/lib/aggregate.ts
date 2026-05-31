/**
 * aggregate.ts
 * Pure, deterministic aggregation over Transaction[]. These are what the Gemini
 * layer calls after it decides what to compute. No AI here. The model never does
 * arithmetic on raw rows; these functions own the correct totals.
 */

import type { Transaction, Category } from "./contract";

/** Real outgoing purchases only. Excludes fees, interest, ATM, credits, payments. */
export function spendOnly(txns: Transaction[]): Transaction[] {
  return txns.filter((t) => t.isSpend);
}

/** Total dollars of real spend in the given set. */
export function totalSpend(txns: Transaction[]): number {
  return spendOnly(txns).reduce((sum, t) => sum + t.amount, 0);
}

/** Spend grouped by category, sorted high to low. Empty input returns []. */
export function spendByCategory(txns: Transaction[]): { category: Category; total: number }[] {
  const totals = new Map<Category, number>();
  for (const t of spendOnly(txns)) {
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/** Top N merchants by spend, sorted high to low. */
export function spendByMerchant(txns: Transaction[], topN = 10): { merchant: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const t of spendOnly(txns)) {
    totals.set(t.merchant, (totals.get(t.merchant) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([merchant, total]) => ({ merchant, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);
}

/** Bucket key for a date at day, week (ISO), or month resolution. */
function bucketKey(iso: string, bucket: "day" | "week" | "month"): string {
  if (bucket === "day") return iso;
  if (bucket === "month") return iso.slice(0, 7); // YYYY-MM
  // ISO week: YYYY-Www
  const date = new Date(iso + "T00:00:00Z");
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Spend over time, bucketed. Rows without a txnDate are skipped, never crash. */
export function spendOverTime(
  txns: Transaction[],
  bucket: "day" | "week" | "month",
): { label: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const t of spendOnly(txns)) {
    if (!t.txnDate) continue;
    const key = bucketKey(t.txnDate, bucket);
    totals.set(key, (totals.get(key) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label)); // chronological
}

/** Inclusive date-range filter. Rows without a txnDate are excluded. */
export function filterByDateRange(txns: Transaction[], startISO: string, endISO: string): Transaction[] {
  return txns.filter((t) => t.txnDate !== null && t.txnDate >= startISO && t.txnDate <= endISO);
}

/** Exact category filter. */
export function filterByCategory(txns: Transaction[], category: Category): Transaction[] {
  return txns.filter((t) => t.category === category);
}

/** Charges at or above a dollar floor (real spend only). */
export function filterByMinAmount(txns: Transaction[], minAmount: number): Transaction[] {
  return spendOnly(txns).filter((t) => t.amount >= minAmount);
}

/**
 * Case-insensitive substring match on the merchant name. Returns the matching transactions
 * (spend or not; the caller decides what to do with them). An empty or whitespace-only
 * query returns [] so a blank search never accidentally matches the whole dataset. This is
 * the merchant-name search the old query planner lacked; the pre-approval history view uses
 * it, and it is available to any caller.
 */
export function filterByMerchant(txns: Transaction[], merchantQuery: string): Transaction[] {
  const needle = merchantQuery.trim().toLowerCase();
  if (needle.length === 0) return [];
  return txns.filter((t) => t.merchant.toLowerCase().includes(needle));
}
