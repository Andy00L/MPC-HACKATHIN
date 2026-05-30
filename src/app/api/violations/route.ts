/**
 * app/api/violations/route.ts
 * GET /api/violations  ->  the policy-compliance results. Runs findViolations on the
 * dataset, fills each violation's in-character narration, and returns the ranked list
 * plus the repeat-offender ranking. No body needed.
 */

import { NextResponse } from "next/server";
import type { Transaction } from "@/lib/contract";
import { findViolations, repeatOffenders } from "@/lib/compliance";
import { violationNarration } from "@/lib/gemini/persona";
import dataset from "@/data/dataset.json";

const transactions = dataset as Transaction[];

export async function GET() {
  try {
    const violations = findViolations(transactions).map((v) => ({
      ...v,
      // Fill the spoken line with the fast template (no Gemini call needed here).
      narration: violationNarration(v.ruleId, v.severity, v.txn.merchant),
    }));

    return NextResponse.json({
      violations,
      repeatOffenders: repeatOffenders(violations),
      count: violations.length,
    });
  } catch (err) {
    console.error("GET /api/violations failed", err);
    return NextResponse.json({ error: "Could not scan the ledger." }, { status: 502 });
  }
}
