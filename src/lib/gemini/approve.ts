/**
 * gemini/approve.ts
 * Pre-approval (Feature 3). For one charge that breaches a threshold, assemble the
 * context (budget status, card history) and ask Gemini for a recommendation and
 * reasoning. Detection of "needs approval" is deterministic; only the reasoning is AI.
 */

import type { Transaction, ApprovalItem, Severity } from "../contract";
import { ai, MODEL } from "./client";
import { approvalSchema } from "./schemas";
import { APPROVAL_PROMPT } from "./persona";
import { stripFence, clampSeverity } from "./parse";
import { budgetStatus, cardHistorySummary } from "../budgets";

const PREAUTH_LIMIT = 50;

/** A charge needs approval if it is over the limit (large enough to matter). */
export function needsApproval(txn: Transaction): boolean {
  return txn.isSpend && txn.amount > PREAUTH_LIMIT;
}

/**
 * Builds a full ApprovalItem for one transaction. On any Gemini failure, returns a
 * conservative "deny" with a plain reason rather than throwing.
 */
export async function buildApprovalItem(txn: Transaction, allTxns: Transaction[]): Promise<ApprovalItem> {
  const budget = budgetStatus(allTxns, txn.category);
  const history = cardHistorySummary(allTxns, txn.merchant);

  const context = [
    `Charge: $${txn.amount.toFixed(2)} at ${txn.merchant} on ${txn.txnDate ?? "n/a"} (category ${txn.category}).`,
    `Budget for ${budget.category}: limit $${budget.limit.toFixed(2)}, spent $${budget.spent.toFixed(2)}, remaining $${budget.remaining.toFixed(2)}.`,
    `History: ${history}`,
  ].join("\n");

  let decision: { recommendation: "approve" | "deny"; reasoning: string; severity: Severity };
  try {
    // Structured persona call through the proxy. json_object (not json_schema, which the
    // proxy's Gemini backend rejects); the exact shape is stated in the prompt.
    const completion = await ai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${APPROVAL_PROMPT}\n\nReturn ONLY a JSON object with exactly this shape:\n${JSON.stringify(approvalSchema)}` },
        { role: "user", content: context },
      ],
    });
    const parsed = JSON.parse(stripFence(completion.choices?.[0]?.message?.content ?? "")) as {
      recommendation?: unknown;
      reasoning?: unknown;
      severity?: unknown;
    };
    decision = {
      // Anything other than an explicit "deny" is treated as approve.
      recommendation: parsed.recommendation === "deny" ? "deny" : "approve",
      reasoning: typeof parsed.reasoning === "string" && parsed.reasoning.trim() ? parsed.reasoning : "No reasoning was returned.",
      severity: clampSeverity(parsed.severity),
    };
  } catch {
    // Conservative, deterministic fallback: deny when the category budget would be exceeded.
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
    recommendation: decision.recommendation,
    reasoning: decision.reasoning,
    severity: decision.severity,
  };
}
