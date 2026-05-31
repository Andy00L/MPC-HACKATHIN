/**
 * app/api/overview/route.ts
 * GET /api/overview — deterministic spend aggregations computed directly from
 * dataset.json. No AI call needed; these are simple group-by sums that Gemini was
 * previously asked to derive via SQL, making them fragile (credit limits, latency).
 * Returns: totalSpend, categoryShare, trend (by month), topVendors.
 */
import { NextResponse } from "next/server";
import type { Transaction } from "@/lib/contract";
import dataset from "@/data/dataset.json";

export const runtime = "nodejs";

const transactions = (dataset as unknown as Transaction[]).filter((t) => t.isSpend);

function prettify(slug: string): string {
  return slug.split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function groupSum(items: Transaction[], key: (t: Transaction) => string | null): { label: string; value: number }[] {
  const map: Record<string, number> = {};
  for (const t of items) {
    const k = key(t);
    if (!k) continue;
    map[k] = (map[k] ?? 0) + t.amount;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
}

export async function GET() {
  const totalSpend = transactions.reduce((s, t) => s + t.amount, 0);

  const categoryShare = groupSum(transactions, (t) => prettify(t.category));

  const trend = groupSum(transactions, (t) => (t.txnDate ? t.txnDate.slice(0, 7) : null))
    .sort((a, b) => a.label.localeCompare(b.label)); // chronological order for the chart

  const topVendors = groupSum(transactions, (t) => t.merchant).slice(0, 15);

  return NextResponse.json({ totalSpend, categoryShare, trend, topVendors });
}
