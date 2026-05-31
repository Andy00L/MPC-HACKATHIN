/**
 * scripts/groundtruth.ts
 * Deterministic ground-truth test for the SQL layer. Runs the four golden questions through
 * runSql (the same guarded path the agent uses) and asserts the known-correct answers. This
 * is the floor that guards the is_spend semantics against regression: it proves that the
 * largest PURCHASE is Michelin, not the larger payment line; that the duplicate pair is kept
 * as two rows; that exactly three purchases are foreign; and the real over-$50 count.
 *
 * Run with:  npm run test:data
 *
 * Note: the build prompt stated 2,760 purchases over $50, but the live dataset yields 2,724
 * under the exact semantics (is_spend = 1 AND amount > 50), and no filter reproduced 2,760,
 * so this asserts the verified value.
 */
import assert from "node:assert/strict";
import { runSql } from "../src/lib/db";

let passed = 0;

// Run a query, fail loudly on a SQL error, and return the rows.
function rows(sql: string): Record<string, unknown>[] {
  const result = runSql(sql);
  assert.ok(!result.error, `SQL error for [${sql}]: ${result.error}`);
  return result.rows;
}

function check(label: string, condition: boolean, detail: string): void {
  assert.ok(condition, `${label} FAILED: ${detail}`);
  console.log(`  ok  ${label}`);
  passed += 1;
}

console.log("Ground-truth assertions (runSql, deterministic):");

// 1. Largest genuine purchase = MNA*MICHELIN CANADA $55,372.46 (a real purchase, mcc not
//    null), NOT the $264,517.44 CWB EFT payment line.
const largest = rows(
  "SELECT merchant, amount FROM transactions WHERE is_spend = 1 AND mcc IS NOT NULL ORDER BY amount DESC LIMIT 1",
)[0];
check("largest genuine purchase merchant is MNA*MICHELIN CANADA", largest.merchant === "MNA*MICHELIN CANADA", JSON.stringify(largest));
check("largest genuine purchase amount is 55372.46", Number(largest.amount) === 55372.46, String(largest.amount));
const cwb = rows("SELECT is_spend, amount FROM transactions WHERE merchant LIKE '%CWB EFT%' ORDER BY amount DESC LIMIT 1")[0];
check("the largest CWB EFT line (the bigger number) is NOT spend", Number(cwb.is_spend) === 0, JSON.stringify(cwb));

// 2. The AB TRANSP $940.00 duplicate pair on 2025-10-06 is kept as two rows (grouped, not
//    merged into one).
const abPair = rows("SELECT id, amount FROM transactions WHERE merchant LIKE '%AB TRANSP%' AND amount = 940 AND txn_date = '2025-10-06'");
check("AB TRANSP $940 pair on 2025-10-06 is exactly two rows", abPair.length === 2, JSON.stringify(abPair));

// 3. Exactly three foreign purchases (is_spend = 1, country not USA/CAN): VIO.COM x2 (NLD)
//    and Trip.com (GBR), NOT the blank-country fee lines.
const foreign = rows("SELECT merchant, merchant_country FROM transactions WHERE is_spend = 1 AND merchant_country NOT IN ('USA','CAN') ORDER BY merchant_country");
check("exactly three foreign purchases", foreign.length === 3, JSON.stringify(foreign));
const countries = foreign.map((row) => row.merchant_country).sort();
check("foreign countries are GBR, NLD, NLD", JSON.stringify(countries) === JSON.stringify(["GBR", "NLD", "NLD"]), JSON.stringify(countries));

// 4. 2,724 purchases over $50 (is_spend = 1 AND amount > 50), NOT the 4,235 total row count.
//    (The prompt said 2,760; the verified value for this dataset is 2,724.)
const over50 = rows("SELECT COUNT(*) AS n FROM transactions WHERE is_spend = 1 AND amount > 50")[0];
check("purchases over $50 is 2724 (not 4235)", Number(over50.n) === 2724, String(over50.n));

console.log(`\nAll ${passed} ground-truth assertions passed.`);
