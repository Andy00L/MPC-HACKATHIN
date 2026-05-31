/**
 * app/api/rules/route.ts
 * GET  /api/rules  → returns the current active RuleSet.
 * POST /api/rules  → patches the RuleSet and returns { rules, violationCount }
 *                    so the UI can re-render immediately without a second fetch.
 */
import { NextRequest, NextResponse } from "next/server";
import type { Transaction } from "@/lib/contract";
import { getRules, setRules } from "@/lib/rules";
import { findViolations } from "@/lib/compliance";
import dataset from "@/data/dataset.json";

export const runtime = "nodejs";

const transactions = dataset as Transaction[];

export async function GET() {
  return NextResponse.json({ rules: getRules() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid rule patch." }, { status: 400 });
  }
  const rules = setRules(body as Parameters<typeof setRules>[0]);
  const violationCount = findViolations(transactions, rules).length;
  return NextResponse.json({ rules, violationCount });
}
