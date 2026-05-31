/**
 * gemini/approve.ts
 * Pre-approval (Feature 3). For one charge that breaches a threshold, assemble the
 * context (budget status, card history, employee + department history) and ask Gemini
 * for a recommendation and reasoning. Detection is deterministic; only reasoning is AI.
 */

import type { Transaction, ApprovalItem, Severity } from "../contract";
import { ai, MODEL } from "./client";
import { approvalSchema } from "./schemas";
import { APPROVAL_PROMPT } from "./persona";
import { stripFence, clampSeverity } from "./parse";
import { budgetStatus, cardHistorySummary } from "../budgets";

const PREAUTH_LIMIT = 50;

export function needsApproval(txn: Transaction): boolean {
  return txn.isSpend && txn.amount > PREAUTH_LIMIT;
}

// Summarise this employee's spending history across all transactions.
function buildEmployeeSummary(txn: Transaction, allTxns: Transaction[]): string {
  const empId = txn.employeeId;
  const dept = txn.department;
  if (!empId) return "Employee unknown.";

  const empTxns = allTxns.filter((t) => t.isSpend && t.employeeId === empId);
  if (empTxns.length === 0) return `${empId} · ${dept ?? "Unknown dept"} — no prior charges on record.`;

  const total = empTxns.reduce((s, t) => s + t.amount, 0);
  const avg = total / empTxns.length;

  // Category breakdown for this employee
  const catTotals: Record<string, number> = {};
  for (const t of empTxns) catTotals[t.category] = (catTotals[t.category] ?? 0) + t.amount;
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];

  // Flag if this charge's category is unusual for the employee
  const thisCatCount = empTxns.filter((t) => t.category === txn.category).length;
  const unusual = thisCatCount === 0 ? ` (no prior ${txn.category} charges for this employee)` : "";

  return `${empId} · ${dept ?? "Unknown dept"} — ${empTxns.length} charges, avg $${avg.toFixed(0)}, top category: ${topCat?.[0] ?? "n/a"}${unusual}`;
}

// Department-level context: is this category normal for the department?
function buildDeptContext(txn: Transaction, allTxns: Transaction[]): string {
  const dept = txn.department;
  if (!dept) return "";

  const deptTxns = allTxns.filter((t) => t.isSpend && t.department === dept);
  if (deptTxns.length === 0) return "";

  const deptCatCounts: Record<string, number> = {};
  for (const t of deptTxns) deptCatCounts[t.category] = (deptCatCounts[t.category] ?? 0) + 1;

  const thisCatPct = deptTxns.length > 0
    ? Math.round(((deptCatCounts[txn.category] ?? 0) / deptTxns.length) * 100)
    : 0;

  const topCats = Object.entries(deptCatCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => c)
    .join(", ");

  if (thisCatPct === 0) {
    return `${dept} dept (${deptTxns.length} charges): ${txn.category} is UNUSUAL — no prior charges in this category for this department. Top categories: ${topCats}.`;
  }
  return `${dept} dept (${deptTxns.length} charges): ${txn.category} is ${thisCatPct}% of dept spend. Top categories: ${topCats}.`;
}

export async function buildApprovalItem(txn: Transaction, allTxns: Transaction[]): Promise<ApprovalItem> {
  const budget = budgetStatus(allTxns, txn.category);
  const history = cardHistorySummary(allTxns, txn.merchant);
  const employeeSummary = buildEmployeeSummary(txn, allTxns);
  const deptContext = buildDeptContext(txn, allTxns);

  const context = [
    `Charge: $${txn.amount.toFixed(2)} at ${txn.merchant} on ${txn.txnDate ?? "n/a"} (category: ${txn.category}).`,
    `Employee: ${txn.employeeId ?? "unknown"} | Department: ${txn.department ?? "unknown"}`,
    `Employee history: ${employeeSummary}`,
    deptContext ? `Department context: ${deptContext}` : "",
    `Budget for ${budget.category}: limit $${budget.limit.toFixed(2)}, spent $${budget.spent.toFixed(2)}, remaining $${budget.remaining.toFixed(2)}.`,
    `Merchant history: ${history}`,
  ].filter(Boolean).join("\n");

  let decision: { recommendation: "approve" | "deny"; reasoning: string; severity: Severity };
  try {
    const completion = await ai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${APPROVAL_PROMPT}\n\nPay attention to the employee's department — flag charges in categories unusual for that department as suspicious. Return ONLY a JSON object with exactly this shape:\n${JSON.stringify(approvalSchema)}`,
        },
        { role: "user", content: context },
      ],
    });
    const parsed = JSON.parse(stripFence(completion.choices?.[0]?.message?.content ?? "")) as {
      recommendation?: unknown;
      reasoning?: unknown;
      severity?: unknown;
    };
    decision = {
      recommendation: parsed.recommendation === "deny" ? "deny" : "approve",
      reasoning: typeof parsed.reasoning === "string" && parsed.reasoning.trim() ? parsed.reasoning : "No reasoning was returned.",
      severity: clampSeverity(parsed.severity),
    };
  } catch {
    decision = {
      recommendation: budget.remaining < txn.amount ? "deny" : "approve",
      reasoning:
        budget.remaining < txn.amount
          ? "Category budget would be exceeded by this charge."
          : "Within the category budget; no policy conflict detected.",
      severity: txn.amount >= 2000 ? 2 : 1,
    };
  }

  return {
    txn,
    categoryBudget: budget,
    cardHistorySummary: history,
    employeeSummary,
    recommendation: decision.recommendation,
    reasoning: decision.reasoning,
    severity: decision.severity,
  };
}
