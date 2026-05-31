/**
 * contract.ts
 * The single source of truth for the data shapes shared between the engine and the
 * UI. Both sides import these. Changing a field is a spoken agreement, never silent.
 */

// A cleaned transaction. Produced by the parser, consumed by everything.
export interface Transaction {
  id: string;
  txnDate: string | null; // ISO yyyy-mm-dd
  postingDate: string | null;
  merchant: string;
  description: string;
  amount: number; // positive; direction carries the sign meaning
  direction: "debit" | "credit";
  transactionCode: string;
  lineType: "purchase" | "fee" | "interest" | "atm" | "credit" | "payment" | "other";
  mcc: string | null;
  category: Category;
  city: string | null;
  state: string | null;
  country: string | null;
  isSpend: boolean; // true only for real outgoing purchases
  employeeId: string | null;
  department: string | null;
}

export type Category =
  | "fuel"
  | "permits_gov"
  | "vehicle_maintenance"
  | "supplies"
  | "tolls"
  | "telecom"
  | "digital"
  | "transport"
  | "parking"
  | "car_rental"
  | "lodging"
  | "airfare"
  | "meal"
  | "alcohol"
  | "marketplace"
  | "gift_card"
  | "other";

// 0 neutral, 1 concerned, 2 alarmed. Drives the character's face and voice tone.
export type Severity = 0 | 1 | 2;

// A chart the UI renders. The engine decides the shape; the UI just draws it.
export interface ChartSpec {
  kind: "bar" | "line" | "donut" | "none";
  title: string;
  xLabel?: string;
  yLabel?: string;
  series: { label: string; value: number }[];
}

// The answer to a natural-language question.
export interface QueryResult {
  answerText: string; // plain-language answer for the dialog box
  narration: string; // the in-character line the keeper speaks
  severity: Severity;
  chart: ChartSpec; // kind "none" when a number or sentence is enough
  tableRows?: Record<string, string | number>[]; // optional detail table
}

// A flagged transaction (a policy violation, not "fraud").
export interface Violation {
  txn: Transaction;
  ruleId: string; // stable id, e.g. "OVER_PREAUTH"
  severity: Severity;
  reasons: string[]; // short plain-language chips
  narration: string; // the keeper's spoken line for this flag
}

// One transaction routed for approval.
export interface ApprovalItem {
  txn: Transaction;
  categoryBudget: { category: Category; limit: number; spent: number; remaining: number };
  cardHistorySummary: string; // e.g. "12 prior charges at this merchant, avg $84"
  employeeSummary: string;    // e.g. "EMP0196 · Administration — 12 prior charges, avg $84"
  recommendation: "approve" | "deny";
  reasoning: string;
  severity: Severity;
}

// A grouped trip report.
export interface ExpenseReport {
  id: string;
  label: string; // e.g. "North Dakota run, Sep 8 to Sep 11"
  startDate: string;
  endDate: string;
  region: string; // dominant state or province
  transactions: Transaction[];
  totalsByCategory: { category: Category; total: number }[];
  total: number;
  violations: Violation[]; // policy checks run on the group
  narration: string;
}
