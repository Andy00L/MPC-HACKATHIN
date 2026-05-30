/**
 * compliance.ts
 * The policy-compliance engine for the Brim track. Pure, deterministic detection:
 * no AI in the flagging itself (AI only narrates the result downstream). It scans
 * cleaned transactions and returns ranked Violations, each with a Severity (0/1/2)
 * and plain-language reasons.
 *
 * Thresholds come from the Brim expense policy (the $50 pre-authorization rule, the
 * personal-use / gift-card ban) and from the shape of the real data.
 */

import type { Transaction, Violation, Severity } from "./contract";

const PREAUTH_LIMIT = 50; // Expenses over $50 require pre-authorization.
const HIGH_VALUE = 2000; // Above this, an over-limit charge is always severity 2.
const DUP_WINDOW_DAYS = 1; // "Duplicate" means identical charges within this many days.
const ANOMALY_Z = 3.5; // Modified z-score cutoff (Iglewicz and Hoaglin).
const MIN_BASELINE = 5; // A category needs at least this many charges to score anomalies.

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
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function overPreauth(spend: Transaction[]): Violation[] {
  return spend
    .filter((t) => t.amount > PREAUTH_LIMIT)
    .map((t) => ({
      txn: t,
      ruleId: "OVER_PREAUTH",
      severity: (t.amount >= HIGH_VALUE ? 2 : 1) as Severity,
      reasons: [`${money(t.amount)} is over the ${money(PREAUTH_LIMIT)} pre-authorization limit`],
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
      reasons: ["Gift card purchase on a corporate card (personal-use policy violation)"],
      narration: "",
    }));
}

function duplicates(spend: Transaction[]): Violation[] {
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
        reasons: [
          `Duplicate: ${clustered.length} identical charges of ${money(t.amount)} at ${t.merchant} within ${DUP_WINDOW_DAYS} day`,
        ],
        narration: "",
      });
    }
  }
  return out;
}

function anomalies(spend: Transaction[]): Violation[] {
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
        flagged = modifiedZ > ANOMALY_Z;
      } else {
        flagged = med > 0 && t.amount > med * 10;
      }

      if (flagged) {
        const multiple = med > 0 ? Math.round(t.amount / med) : 0;
        out.push({
          txn: t,
          ruleId: "ANOMALY",
          severity: 2,
          reasons: [
            `${money(t.amount)} is far above the ${t.category} norm (about ${multiple}x the median of ${money(med)})`,
          ],
          narration: "",
        });
      }
    }
  }
  return out;
}

function splits(spend: Transaction[]): Violation[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of spend) {
    if (!t.txnDate) continue;
    pushToGroup(groups, `${t.merchant}|${t.txnDate}`, t);
  }

  const out: Violation[] = [];
  for (const group of groups.values()) {
    const underLimit = group.filter((t) => t.amount <= PREAUTH_LIMIT);
    if (underLimit.length < 2) continue;

    const sum = underLimit.reduce((acc, t) => acc + t.amount, 0);
    if (sum <= PREAUTH_LIMIT) continue;

    for (const t of underLimit) {
      out.push({
        txn: t,
        ruleId: "SPLIT",
        severity: 2,
        reasons: [
          `Possible split: ${underLimit.length} charges at ${t.merchant} on ${t.txnDate} total ${money(sum)}, each kept under the ${money(PREAUTH_LIMIT)} limit`,
        ],
        narration: "",
      });
    }
  }
  return out;
}

/**
 * Runs every rule, merges multiple flags on the same transaction into one card
 * (max severity, combined reasons, most-severe rule as the primary label), and
 * returns the result sorted worst-first for the review queue.
 */
export function findViolations(allTxns: Transaction[]): Violation[] {
  const spend = allTxns.filter((t) => t.isSpend);

  const raw: Violation[] = [
    ...overPreauth(spend),
    ...giftCard(spend),
    ...duplicates(spend),
    ...anomalies(spend),
    ...splits(spend),
  ];

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

  return [...merged.values()].sort((a, b) => b.severity - a.severity);
}

/** Ranks merchants by how many flags they trip. Surfaces repeat offenders. */
export function repeatOffenders(violations: Violation[]): { merchant: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of violations) {
    counts.set(v.txn.merchant, (counts.get(v.txn.merchant) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([merchant, count]) => ({ merchant, count }))
    .sort((a, b) => b.count - a.count);
}
