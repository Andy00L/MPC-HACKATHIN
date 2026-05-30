/**
 * budgets.ts
 * Category budgets and budget status. The data has no budgets, so the finance team
 * defines them here (the brief allows this). Tune CATEGORY_BUDGETS to the real
 * category totals so "remaining" is meaningful. Without that tuning, Feature 3 is
 * theater, so either tune it or drop pre-approval.
 */

import type { Transaction, Category } from "./contract";
import { totalSpend, filterByCategory, spendOnly } from "./aggregate";

// Budget per category for the period covered by the dataset. Set these against the
// actual totals; numbers below are placeholders to be tuned during the build.
export const CATEGORY_BUDGETS: Record<Category, number> = {
  fuel: 200000,
  permits_gov: 150000,
  vehicle_maintenance: 80000,
  supplies: 40000,
  tolls: 20000,
  telecom: 10000,
  digital: 8000,
  gift_card: 0, // no budget for gift cards; any spend here is a policy violation
  transport: 15000,
  other: 25000,
};

export interface BudgetStatus {
  category: Category;
  limit: number;
  spent: number;
  remaining: number;
}

/** Spent-vs-limit for one category, computed from real spend. */
export function budgetStatus(txns: Transaction[], category: Category): BudgetStatus {
  const limit = CATEGORY_BUDGETS[category];
  const spent = totalSpend(filterByCategory(spendOnly(txns), category));
  return { category, limit, spent, remaining: limit - spent };
}

/** One short line summarizing this card's history at a given merchant. */
export function cardHistorySummary(txns: Transaction[], merchant: string): string {
  const prior = spendOnly(txns).filter((t) => t.merchant === merchant);
  if (prior.length === 0) return "No prior charges at this merchant.";
  const total = prior.reduce((sum, t) => sum + t.amount, 0);
  const avg = total / prior.length;
  return `${prior.length} prior charge(s) at this merchant, averaging $${avg.toFixed(2)}.`;
}
