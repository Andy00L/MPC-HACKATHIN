/**
 * app/api/violations/route.ts
 * GET /api/violations  →  two-pass policy scan:
 *   Pass 1 (sync):  findViolations(transactions, rules) — deterministic rule checks.
 *   Pass 2 (async): applyContextualRules — Gemini judgment for meal/alcohol rows.
 * Returns ranked violations, repeat offenders, dataset totals, and the active rules.
 */
import { NextResponse } from "next/server";
import type { Transaction } from "@/lib/contract";
import { findViolations, applyContextualRules, mergeViolationSets, repeatOffenders } from "@/lib/compliance";
import { getRules } from "@/lib/rules";
import { violationNarration } from "@/lib/gemini/persona";
import dataset from "@/data/dataset.json";

export const runtime = "nodejs";

const transactions = dataset as Transaction[];

export async function GET() {
  try {
    const rules = getRules();

    const [base, contextual] = await Promise.all([
      Promise.resolve(findViolations(transactions, rules)),
      applyContextualRules(transactions, rules),
    ]);

    const violations = mergeViolationSets(base, contextual).map((v) => ({
      ...v,
      narration: violationNarration(v.ruleId, v.severity, v.txn.merchant),
    }));

    return NextResponse.json({
      violations,
      repeatOffenders: repeatOffenders(violations),
      count: violations.length,
      transactionCount: transactions.length,
      spendCount: transactions.filter((t) => t.isSpend).length,
      rules,
    });
  } catch (err) {
    console.error("GET /api/violations failed", err);
    return NextResponse.json({ error: "Could not scan the ledger." }, { status: 502 });
  }
}
