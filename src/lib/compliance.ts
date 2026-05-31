/**
 * compliance.ts
 * The policy-compliance engine. Two passes:
 *   Pass 1 (sync):  findViolations(transactions, rules) — deterministic rule checks.
 *   Pass 2 (async): applyContextualRules(transactions, rules) — Gemini judgment for
 *                   meal/alcohol rows when context flags are enabled.
 * mergeViolationSets combines both, with PENDING_CONTEXT suppressing CATEGORY_LIMIT
 * for the same transaction (cannot evaluate a limit without the receipt).
 */

import type { Transaction, Violation, Severity } from "./contract";
import type { RuleSet } from "./rules";

const HIGH_VALUE = 2000;
const DUP_WINDOW_DAYS = 1;
const ANOMALY_Z = 3.5;
const ANOMALY_MEDIAN_MULTIPLE = 4;
const MIN_BASELINE = 5;

const CONTEXT_SENSITIVE = new Set(["meal", "alcohol"]);

interface Classification {
  policy_category: string;
  is_reimbursable: boolean | null;
  requires_context: boolean;
  missing_context: string[];
  confidence: number;
  policy_clause: string;
  reasoning: string;
}

function pushToGroup<T>(groups: Map<string, T[]>, key: string, value: T): void {
  const bucket = groups.get(key);
  if (bucket) bucket.push(value);
  else groups.set(key, [value]);
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(da - db) / 86_400_000;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianAbsoluteDeviation(values: number[], med: number): number {
  if (values.length === 0) return 0;
  return median(values.map((v) => Math.abs(v - med)));
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function overPreauth(spend: Transaction[], rules: RuleSet): Violation[] {
  const limit = rules.preauthThreshold;
  if (limit === 0) return [];
  return spend
    .filter((t) => {
      if (t.amount <= limit) return false;
      // Suppress when the category already has a dedicated limit — that IS the policy.
      const cap = rules.categoryLimits[t.category as keyof typeof rules.categoryLimits];
      if (cap !== undefined && cap > 0) return false;
      return true;
    })
    .map((t) => ({
      txn: t,
      ruleId: "OVER_PREAUTH",
      severity: (t.amount >= HIGH_VALUE ? 2 : 1) as Severity,
      reasons: [`${money(t.amount)} exceeds the ${money(limit)} pre-authorization limit`],
      narration: "",
    }));
}

function categoryLimitRule(spend: Transaction[], rules: RuleSet): Violation[] {
  const out: Violation[] = [];
  for (const t of spend) {
    const cap = rules.categoryLimits[t.category as keyof typeof rules.categoryLimits];
    // cap > 0 guard is required — 0 would flag every transaction above $0
    if (cap !== undefined && cap > 0 && t.amount > cap) {
      out.push({
        txn: t,
        ruleId: "CATEGORY_LIMIT",
        severity: (t.amount > cap * 2 ? 2 : 1) as Severity,
        reasons: [`${money(t.amount)} exceeds the ${t.category.replace(/_/g, " ")} limit of ${money(cap)}`],
        narration: "",
      });
    }
  }
  return out;
}

function alcoholRule(spend: Transaction[], rules: RuleSet): Violation[] {
  if (!rules.enableAlcohol) return [];
  return spend
    .filter((t) => t.category === "alcohol" || t.mcc === "5921" || t.mcc === "5813")
    .map((t) => ({
      txn: t,
      ruleId: "ALCOHOL",
      severity: 1 as Severity,
      reasons: ["Alcohol purchase; policy allows reimbursement only when dining with a customer"],
      narration: "",
    }));
}

function giftCard(spend: Transaction[]): Violation[] {
  return spend
    .filter((t) => t.category === "gift_card")
    .map((t) => ({
      txn: t,
      ruleId: "GIFT_CARD",
      severity: 2 as Severity,
      reasons: ["Gift card on a corporate card — personal-use policy violation"],
      narration: "",
    }));
}

function duplicatesRule(spend: Transaction[], rules: RuleSet): Violation[] {
  if (!rules.enableDuplicate) return [];
  const groups = new Map<string, Transaction[]>();
  for (const t of spend) {
    pushToGroup(groups, `${t.merchant}|${t.amount.toFixed(2)}`, t);
  }

  const out: Violation[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const clustered = group.filter((t) =>
      group.some((other) => {
        if (other.id === t.id) return false;
        const gap = daysBetween(t.txnDate, other.txnDate);
        return gap !== null && gap <= DUP_WINDOW_DAYS;
      }),
    );
    if (clustered.length < 2) continue;

    const severity: Severity = clustered.length >= 3 ? 2 : 1;
    for (const t of clustered) {
      out.push({
        txn: t,
        ruleId: "DUPLICATE",
        severity,
        reasons: [`Duplicate: ${clustered.length} identical charges of ${money(t.amount)} at ${t.merchant} within ${DUP_WINDOW_DAYS} day`],
        narration: "",
      });
    }
  }
  return out;
}

function anomaliesRule(spend: Transaction[], rules: RuleSet): Violation[] {
  if (!rules.enableAnomaly) return [];
  const byCategory = new Map<string, Transaction[]>();
  for (const t of spend) {
    pushToGroup(byCategory, t.category, t);
  }

  const out: Violation[] = [];
  for (const txns of byCategory.values()) {
    if (txns.length < MIN_BASELINE) continue;

    const amounts = txns.map((t) => t.amount);
    const med = median(amounts);
    const spread = medianAbsoluteDeviation(amounts, med);

    for (const t of txns) {
      let flagged = false;
      if (spread > 0) {
        const modifiedZ = (0.6745 * (t.amount - med)) / spread;
        flagged = modifiedZ > ANOMALY_Z && med > 0 && t.amount > med * ANOMALY_MEDIAN_MULTIPLE;
      } else {
        flagged = med > 0 && t.amount > med * 10;
      }

      if (flagged) {
        const multiple = med > 0 ? Math.round(t.amount / med) : 0;
        out.push({
          txn: t,
          ruleId: "ANOMALY",
          severity: 2,
          reasons: [`${money(t.amount)} is far above the ${t.category} norm (about ${multiple}x the median of ${money(med)})`],
          narration: "",
        });
      }
    }
  }
  return out;
}

function splitsRule(spend: Transaction[], rules: RuleSet): Violation[] {
  const threshold = rules.splitThreshold;
  if (threshold === 0) return [];

  const groups = new Map<string, Transaction[]>();
  for (const t of spend) {
    if (!t.txnDate) continue;
    pushToGroup(groups, `${t.merchant}|${t.txnDate}`, t);
  }

  const out: Violation[] = [];
  for (const group of groups.values()) {
    const underLimit = group.filter((t) => t.amount <= threshold);
    if (underLimit.length < 2) continue;

    const sum = underLimit.reduce((acc, t) => acc + t.amount, 0);
    if (sum <= threshold) continue;

    for (const t of underLimit) {
      out.push({
        txn: t,
        ruleId: "SPLIT",
        severity: 2,
        reasons: [`Possible split: ${underLimit.length} charges at ${t.merchant} on ${t.txnDate} total ${money(sum)}, each kept under the ${money(threshold)} limit`],
        narration: "",
      });
    }
  }
  return out;
}

function foreignRule(spend: Transaction[], rules: RuleSet): Violation[] {
  if (!rules.flagForeignTransactions) return [];
  return spend
    .filter((t) => t.country !== null && t.country !== "CAN")
    .map((t) => ({
      txn: t,
      ruleId: "FOREIGN_TXN",
      severity: 1 as Severity,
      reasons: [`Transaction in ${t.country ?? "unknown country"} — flagged as foreign spend`],
      narration: "",
    }));
}

function mergeAndSort(raw: Violation[]): Violation[] {
  const merged = new Map<string, Violation>();
  for (const v of raw) {
    const existing = merged.get(v.txn.id);
    if (!existing) {
      merged.set(v.txn.id, { ...v, reasons: [...v.reasons] });
      continue;
    }
    if (v.severity > existing.severity) {
      existing.severity = v.severity;
      existing.ruleId = v.ruleId;
    }
    existing.reasons.push(...v.reasons);
  }
  return [...merged.values()].sort((a, b) => b.severity - a.severity || b.txn.amount - a.txn.amount);
}

export function findViolations(allTxns: Transaction[], rules: RuleSet): Violation[] {
  const spend = allTxns.filter((t) => t.isSpend);
  const raw: Violation[] = [
    ...overPreauth(spend, rules),
    ...categoryLimitRule(spend, rules),
    ...alcoholRule(spend, rules),
    ...giftCard(spend),
    ...duplicatesRule(spend, rules),
    ...anomaliesRule(spend, rules),
    ...splitsRule(spend, rules),
    ...foreignRule(spend, rules),
  ];
  return mergeAndSort(raw);
}

// Dynamic import so the module doesn't throw on load when env vars are missing.
async function classifyWithGemini(txn: Transaction): Promise<Classification | null> {
  try {
    const { ai, MODEL } = await import("./gemini/client");
    const weekday = txn.txnDate
      ? new Date(txn.txnDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })
      : "unknown";

    const prompt = `You classify a single corporate-card transaction against the Brim expense policy.
You do NOT have line items, attendees, or receipts unless they appear below.
Never assume facts you were not given.

POLICY (relevant clauses):
- Meals: expenses over $50 require pre-authorization and a receipt.
- Alcohol is reimbursable ONLY when dining with a customer; guest names and business purpose must be recorded. Otherwise alcohol is not reimbursable.
- Tips: up to 15% (service) / 20% (meals). Verifiable only from a receipt.
- Personal charges and personal-vehicle insurance are NOT reimbursable.

TRANSACTION:
  merchant: ${txn.merchant}
  amount: ${txn.amount.toFixed(2)} CAD
  mcc: ${txn.mcc ?? "null"}  (candidate category: ${txn.category})
  date/time: ${txn.txnDate ?? "unknown"} (${weekday})
  city: ${txn.city ?? "unknown"}
  memo/attendees/purpose: null

Return ONLY this JSON — no prose, no markdown, no code fences:
{
  "policy_category": "meal_solo | meal_client | alcohol | car_insurance_personal | personal | other",
  "is_reimbursable": true,
  "requires_context": false,
  "missing_context": [],
  "confidence": 0.9,
  "policy_clause": "",
  "reasoning": "one sentence"
}

Rules:
- Restaurant charge with no attendee/purpose info → policy_category "meal_client", requires_context true, missing_context ["guest_names","business_purpose"], is_reimbursable null.
- Standalone alcohol/bar with no customer context → is_reimbursable false.
- Marketplace / general-merchandise charge → requires_context true, missing_context ["itemized_receipt"], is_reimbursable null.`;

    const completion = await ai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });
    const content = completion.choices?.[0]?.message?.content ?? "";
    return JSON.parse(content) as Classification;
  } catch {
    return null;
  }
}

export async function applyContextualRules(allTxns: Transaction[], rules: RuleSet): Promise<Violation[]> {
  const spend = allTxns.filter((t) => t.isSpend);
  const contextTxns = spend.filter((t) => CONTEXT_SENSITIVE.has(t.category));
  if (contextTxns.length === 0) return [];

  const violations: Violation[] = [];
  for (const txn of contextTxns) {
    const isMeal = txn.category === "meal";
    // Alcohol always evaluated; meals only when enableMealContext is on
    const runContext = isMeal ? rules.enableMealContext : rules.enableAlcohol;
    if (!runContext) continue;

    const classification = await classifyWithGemini(txn);
    if (!classification) continue;

    if (classification.requires_context) {
      violations.push({
        txn,
        ruleId: "PENDING_CONTEXT",
        severity: 0,
        reasons: classification.missing_context.length > 0
          ? classification.missing_context.map((c) => `Missing: ${c.replace(/_/g, " ")}`)
          : ["Receipt or attendee list needed before this can be judged"],
        narration: "",
      });
    } else if (classification.is_reimbursable === false) {
      violations.push({
        txn,
        ruleId: "NON_REIMBURSABLE",
        severity: 2,
        reasons: [classification.policy_clause || classification.reasoning || "Not reimbursable under policy"],
        narration: "",
      });
    }
  }
  return violations;
}

export function mergeViolationSets(base: Violation[], contextual: Violation[]): Violation[] {
  // PENDING_CONTEXT blocks CATEGORY_LIMIT: we cannot evaluate a dollar limit without context.
  const pendingIds = new Set(contextual.filter((v) => v.ruleId === "PENDING_CONTEXT").map((v) => v.txn.id));
  const filtered = base.filter((v) => !(v.ruleId === "CATEGORY_LIMIT" && pendingIds.has(v.txn.id)));
  return mergeAndSort([...filtered, ...contextual]);
}

export function repeatOffenders(violations: Violation[]): { merchant: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of violations) {
    counts.set(v.txn.merchant, (counts.get(v.txn.merchant) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([merchant, count]) => ({ merchant, count }))
    .sort((a, b) => b.count - a.count);
}
