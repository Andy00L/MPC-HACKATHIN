/**
 * scripts/applyCategories.ts
 * Applies merchant_categories.json (the LLM-assigned category cache) back to
 * src/data/dataset.json. For every transaction whose category is "other", normalize
 * the merchant name the same way preprocess_categories would, look it up in the cache,
 * and update the category. Transactions already categorized by MCC (fuel, permits_gov,
 * etc.) are left untouched. Re-running is safe — idempotent.
 *
 * Run with:  npx tsx scripts/applyCategories.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DATASET_PATH = resolve(process.cwd(), "src/data/dataset.json");
const CACHE_PATH = resolve(process.cwd(), "merchant_categories.json");

// Inline normalizeMerchant (mirrors src/lib/merchants.ts exactly).
const BRAND_CANON: [RegExp, string][] = [
  [/^AMZN|^AMAZON/, "AMAZON"],
  [/^WAL-MART|^WALMART/, "WALMART"],
  [/^COSTCO/, "COSTCO"],
  [/^EBAY/, "EBAY"],
  [/^TARGET/, "TARGET"],
];

function normalizeMerchant(raw: string): string {
  let s = raw.trim().toUpperCase();
  s = s.replace(/\*.*$/, "").trim();
  s = (s.replace(/\s+\d{7,}.*$/, "").trim()) || s;
  s = s.replace(/\s*#\d+.*$/, "").trim();
  s = s.replace(/\s+\d{3}-\d{3}-\d{4}.*$/, "").trim();
  s = (s.replace(/\s+\d{2,}[A-Z-]*$/, "").trim()) || s;
  s = s.replace(/\bINSIDE$/, "").trim();
  s = s.replace(/\s+\b(INC|LLC|LTD|CO)\.?\b\s*$/, "").trim();
  for (const [re, canon] of BRAND_CANON) {
    if (re.test(s)) return canon;
  }
  return s;
}

const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, string>;
const transactions = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as Array<{ category: string; merchant: string }>;

let updated = 0;
const categoryCounts: Record<string, number> = {};

for (const txn of transactions) {
  const normalized = normalizeMerchant(txn.merchant);
  const cached = cache[normalized] ?? cache[txn.merchant] ?? cache[txn.merchant.toUpperCase()];
  if (cached && txn.category === "other") {
    txn.category = cached;
    updated++;
  }
  categoryCounts[txn.category] = (categoryCounts[txn.category] ?? 0) + 1;
}

writeFileSync(DATASET_PATH, JSON.stringify(transactions, null, 2));
console.log(`Updated ${updated} transactions.`);
console.log("Category breakdown:", categoryCounts);
