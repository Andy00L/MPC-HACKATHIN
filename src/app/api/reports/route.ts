/**
 * app/api/reports/route.ts
 * GET /api/reports  ->  trip-clustered expense reports (Feature 4). Each report
 * carries its own category totals and policy checks. No body needed.
 */

import { NextResponse } from "next/server";
import type { Transaction } from "@/lib/contract";
import { buildReports } from "@/lib/trips";
import { violationNarration } from "@/lib/gemini/persona";
import dataset from "@/data/dataset.json";

const transactions = dataset as Transaction[];

export async function GET() {
  try {
    const reports = buildReports(transactions).map((report) => ({
      ...report,
      // Fill each report's violation narration with the fast template.
      violations: report.violations.map((v) => ({
        ...v,
        narration: violationNarration(v.ruleId, v.severity, v.txn.merchant),
      })),
    }));

    return NextResponse.json({ reports, count: reports.length });
  } catch (err) {
    console.error("GET /api/reports failed", err);
    return NextResponse.json({ error: "Could not assemble the reports." }, { status: 502 });
  }
}
