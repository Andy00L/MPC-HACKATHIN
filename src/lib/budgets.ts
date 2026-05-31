/**
 * budgets.ts
 * Category budgets and budget status. The dataset carries no budgets, so we derive a
 * defensible one instead of inventing numbers: each category's limit is its ACTUAL spend
 * over the dataset period times a headroom factor, rounded up to the nearest $1,000 (and
 * never below $1,000). That makes "remaining" meaningful (a category that has consumed most
 * of a reasonable envelope shows little left) and honest (it is anchored to real spend).
 * Tune BUDGET_FACTOR to loosen or tighten the envelope.
 */

import type { Transaction, Category } from "./contract";
import { totalSpend, filterByCategory, spendOnly, spendByCategory } from "./aggregate";
import dataset from "./../data/dataset.json";

const allTransactions = dataset as unknown as Transaction[];

// Headroom over actual spend. 1.25 means a 25% envelope above what was actually spent.
const BUDGET_FACTOR = 1.25;
// Floor + rounding granularity, so limits are clean, legible figures.
const BUDGET_STEP = 1000;

// Round a dollar figure up to the nearest `step`.
function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Builds the per-category budget from real spend. Starts from an exhaustive zero record (so
 * adding a Category to the contract is a compile error here until it is given a budget),
 * then sets each category's limit from its actual spend. Categories with little or no spend
 * keep the BUDGET_STEP floor so "remaining" is never a strange zero or negative.
 */
function computeBudgets(): Record<Category, number> {
  const budgets: Record<Category, number> = {
    fuel: 0,
    permits_gov: 0,
    vehicle_maintenance: 0,
    supplies: 0,
    tolls: 0,
    telecom: 0,
    digital: 0,
    gift_card: 0,
    transport: 0,
    other: 0,
  };
  for (const { category, total } of spendByCategory(allTransactions)) {
    budgets[category] = Math.max(roundUpTo(total * BUDGET_FACTOR, BUDGET_STEP), BUDGET_STEP);
  }
  // Floor any category that had no spend, so a zero limit never makes "remaining" odd.
  for (const category of Object.keys(budgets) as Category[]) {
    if (budgets[category] < BUDGET_STEP) budgets[category] = BUDGET_STEP;
  }
  return budgets;
}

// Computed once at module load from the dataset. Real-spend-derived, not invented.
export const CATEGORY_BUDGETS: Record<Category, number> = computeBudgets();

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
