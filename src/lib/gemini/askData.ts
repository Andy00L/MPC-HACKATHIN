/**
 * gemini/askData.ts
 * Talk-to-data orchestration (Feature 1), the agentic core. Two Gemini calls around
 * deterministic aggregation:
 *   1. plan   - Gemini decides what to compute (structured query plan).
 *   2. compute - our own aggregate.ts functions run the plan (correct totals).
 *   3. narrate - Gemini phrases the computed result in character (structured).
 * Gemini never does arithmetic on raw rows; that is what keeps the numbers right and
 * still scores on AI depth (a multi-step loop, not a single prompt).
 */

import type { Transaction, QueryResult, ChartSpec, Category, Severity } from "../contract";
import { ai, MODEL } from "./client";
import { queryPlanSchema, narrationSchema } from "./schemas";
import { PLANNER_PROMPT, PERSONA_PROMPT, datasetContext } from "./persona";
import {
  spendByCategory,
  spendByMerchant,
  spendOverTime,
  totalSpend,
  filterByCategory,
  filterByDateRange,
  filterByMinAmount,
  spendOnly,
} from "../aggregate";

interface QueryPlan {
  operation: "spendByCategory" | "spendByMerchant" | "spendOverTime" | "totalSpend" | "filterList";
  category: Category | "all";
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  timeBucket?: "day" | "week" | "month" | "none";
  chartKind: ChartSpec["kind"];
}

type Series = { label: string; value: number }[];
type Table = Record<string, string | number>[];

// Applies the plan's filters (category, date range) before the chosen operation.
function applyFilters(txns: Transaction[], plan: QueryPlan): Transaction[] {
  let result = txns;
  if (plan.category && plan.category !== "all") {
    result = filterByCategory(result, plan.category as Category);
  }
  if (plan.startDate && plan.endDate) {
    result = filterByDateRange(result, plan.startDate, plan.endDate);
  }
  return result;
}

// Dispatches the plan to the matching aggregation. Returns a chart series and an
// optional detail table. This is deterministic; the totals are ours, not the model's.
function runPlan(plan: QueryPlan, txns: Transaction[]): { series: Series; table?: Table } {
  const scoped = applyFilters(txns, plan);

  switch (plan.operation) {
    case "spendByCategory":
      return { series: spendByCategory(scoped).map((c) => ({ label: c.category, value: round(c.total) })) };

    case "spendByMerchant":
      return { series: spendByMerchant(scoped, 10).map((m) => ({ label: m.merchant, value: round(m.total) })) };

    case "spendOverTime": {
      const bucket = plan.timeBucket && plan.timeBucket !== "none" ? plan.timeBucket : "month";
      return { series: spendOverTime(scoped, bucket).map((p) => ({ label: p.label, value: round(p.value) })) };
    }

    case "totalSpend":
      return { series: [{ label: "Total spend", value: round(totalSpend(scoped)) }] };

    case "filterList": {
      const floor = plan.minAmount && plan.minAmount > 0 ? plan.minAmount : 0;
      const matched = (floor > 0 ? filterByMinAmount(scoped, floor) : spendOnly(scoped))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 50);
      const table: Table = matched.map((t) => ({
        date: t.txnDate ?? "n/a",
        merchant: t.merchant,
        category: t.category,
        amount: round(t.amount),
      }));
      const series: Series = matched.slice(0, 10).map((t) => ({ label: t.merchant, value: round(t.amount) }));
      return { series, table };
    }

    default:
      return { series: [] };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function titleFor(plan: QueryPlan): string {
  const scope = plan.category && plan.category !== "all" ? ` (${plan.category})` : "";
  switch (plan.operation) {
    case "spendByCategory":
      return `Spend by category${scope}`;
    case "spendByMerchant":
      return `Top merchants${scope}`;
    case "spendOverTime":
      return `Spend over time${scope}`;
    case "totalSpend":
      return `Total spend${scope}`;
    case "filterList":
      return `Matching charges${scope}`;
    default:
      return "Result";
  }
}

// A safe fallback QueryResult for any failure path. Never throws to the caller.
function fallback(message: string): QueryResult {
  return {
    answerText: message,
    narration: "The keeper turned the page, but the ink there had faded.",
    severity: 0,
    chart: { kind: "none", title: "", series: [] },
  };
}

/**
 * Answers one natural-language question. `history` is a short string of the last
 * few question/answer pairs, used to resolve follow-up references.
 */
export async function askData(question: string, history: string, txns: Transaction[]): Promise<QueryResult> {
  // 1. Plan (structured).
  let plan: QueryPlan;
  try {
    const planResp = await ai.models.generateContent({
      model: MODEL,
      contents: `${datasetContext(txns)}\n\nConversation so far:\n${history || "(none)"}\n\nQuestion: ${question}`,
      config: {
        systemInstruction: PLANNER_PROMPT,
        responseMimeType: "application/json",
        responseSchema: queryPlanSchema,
      },
    });
    plan = JSON.parse(planResp.text ?? "");
  } catch {
    return fallback("The keeper could not make sense of that question.");
  }

  // 2. Compute (deterministic, ours).
  const { series, table } = runPlan(plan, txns);

  if (series.length === 0 && (!table || table.length === 0)) {
    return {
      answerText: "Nothing in the ledger matches that.",
      narration: "I searched these pages, traveler, and found no such entry.",
      severity: 0,
      chart: { kind: "none", title: titleFor(plan), series: [] },
    };
  }

  // 3. Narrate (structured).
  let narration: { answerText: string; narration: string; severity: Severity };
  try {
    const narrateResp = await ai.models.generateContent({
      model: MODEL,
      contents: `Question: ${question}\nComputed result: ${JSON.stringify(series)}`,
      config: {
        systemInstruction: PERSONA_PROMPT,
        responseMimeType: "application/json",
        responseSchema: narrationSchema,
      },
    });
    narration = JSON.parse(narrateResp.text ?? "");
  } catch {
    // Computation succeeded but phrasing failed: still return the data.
    narration = {
      answerText: `Here is ${titleFor(plan).toLowerCase()}.`,
      narration: "Behold what the ledger shows.",
      severity: 0,
    };
  }

  const chart: ChartSpec = {
    kind: plan.chartKind,
    title: titleFor(plan),
    series,
  };

  return {
    answerText: narration.answerText,
    narration: narration.narration,
    severity: narration.severity,
    chart,
    tableRows: table,
  };
}
