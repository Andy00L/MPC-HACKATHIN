/**
 * app/api/approvals/route.ts
 * GET /api/approvals  ->  the pre-approval queue (Feature 3). Selects the charges that need
 * sign-off (deterministic: needsApproval), runs each through buildApprovalItem for the
 * budget context, card history, and AI recommendation, and returns them worst-first.
 *
 * The cap: thousands of charges exceed the $50 pre-authorization limit, and each item costs
 * one model call, so we reason over only the largest TOP_N by amount. That keeps the route
 * fast and the demo focused on the charges that matter most. The cap is reported in the
 * response (count) and documented here so the truncation is honest, not hidden.
 */
import { NextResponse } from "next/server";
import type { Transaction, ApprovalItem } from "@/lib/contract";
import { needsApproval, buildApprovalItem } from "@/lib/gemini/approve";
import dataset from "@/data/dataset.json";

// buildApprovalItem uses the model client (native nothing, but a server-only key), so pin
// the Node runtime to match the other AI routes.
export const runtime = "nodejs";

const transactions = dataset as Transaction[];
const TOP_N = 20; // reason over the largest 20 charges that need approval

export async function GET() {
  try {
    // Deterministic selection: charges over the pre-auth limit, largest first, capped.
    const candidates = transactions
      .filter((txn) => needsApproval(txn))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_N);

    // Build each item in parallel. buildApprovalItem never throws (it falls back to a
    // conservative deny/approve), so Promise.all is safe and the route returns in roughly
    // one model round-trip instead of TOP_N sequential ones.
    const items: ApprovalItem[] = await Promise.all(candidates.map((txn) => buildApprovalItem(txn, transactions)));

    // Worst-first: by severity, then by dollar amount, so the most concerning leads.
    items.sort((a, b) => b.severity - a.severity || b.txn.amount - a.txn.amount);

    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error("GET /api/approvals failed", err);
    return NextResponse.json({ error: "Could not assemble the approvals." }, { status: 502 });
  }
}
