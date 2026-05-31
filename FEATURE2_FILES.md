# Feature 2 — Policy Compliance Engine: Self-Contained Handoff

This file contains everything another AI needs to reimplement Feature 2 from scratch
in a Next.js App Router project. All critical code is inline — no other files needed.

---

## Architecture overview

```
POST /api/rules   ← finance team sets thresholds/toggles
GET  /api/violations ← two-pass scan returns ranked violations

Pass 1 (sync):  findViolations(transactions, rules)
                → OVER_PREAUTH, CATEGORY_LIMIT, ALCOHOL, DUPLICATE, ANOMALY, SPLIT

Pass 2 (async): applyContextualRules(transactions, rules)
                → only meal + alcohol rows → Gemini → PENDING_CONTEXT or NON_REIMBURSABLE

mergeViolationSets(base, contextual) → one entry per transaction, worst-severity wins
```

---

## 1. Category taxonomy (`src/lib/contract.ts`)

```ts
export type Category =
  | "fuel" | "permits_gov" | "vehicle_maintenance" | "supplies" | "tolls"
  | "telecom" | "digital" | "transport" | "parking" | "car_rental"
  | "lodging" | "airfare" | "meal" | "alcohol" | "marketplace" | "other";

// meal / alcohol appear in t.category after preprocess_categories.ts runs.
// They are NOT exposed as dollar-limit inputs — they use PENDING_CONTEXT instead.
// marketplace IS a dollar-limit category; it does NOT use PENDING_CONTEXT.
```

Also needed from `contract.ts`:
```ts
export type Severity = 0 | 1 | 2;

export interface Transaction {
  id: string;
  txnDate: string | null;
  merchant: string;
  description: string;
  amount: number;
  direction: "debit" | "credit";
  transactionCode: string;
  lineType: "purchase" | "fee" | "interest" | "atm" | "credit" | "payment" | "other";
  mcc: string | null;
  category: Category;
  city: string | null;
  state: string | null;
  country: string | null;
  isSpend: boolean;
}

export interface Violation {
  txn: Transaction;
  ruleId: string;
  severity: Severity;
  reasons: string[];
  narration: string;
}
```

---

## 2. Rule store (`src/lib/rules.ts`)

```ts
import type { Category } from "./contract";

export interface RuleSet {
  preauthThreshold: number;     // 0 = rule disabled
  splitThreshold: number;       // 0 = rule disabled
  categoryLimits: Partial<Record<Category, number>>;
  flagForeignTransactions: boolean;
  enableAnomaly: boolean;
  enableDuplicate: boolean;
  enableAlcohol: boolean;
  enableMealContext: boolean;   // when false: skip PENDING_CONTEXT, apply flat meal $ cap
}

// ALL defaults OFF — user opts in to each rule explicitly
export const DEFAULT_RULES: RuleSet = {
  preauthThreshold: 0,
  splitThreshold: 0,
  categoryLimits: {},
  flagForeignTransactions: false,
  enableAnomaly: false,
  enableDuplicate: false,
  enableAlcohol: false,
  enableMealContext: false,
};

let activeRules: RuleSet = { ...DEFAULT_RULES, categoryLimits: {} };

export function getRules(): RuleSet { return activeRules; }

export function setRules(patch: Partial<RuleSet>): RuleSet {
  activeRules = {
    ...activeRules,
    ...patch,
    // Full replace (not merge) so clearing a limit actually clears it.
    // Strip zero/blank entries — 0 means "no limit", not "flag everything".
    categoryLimits: patch.categoryLimits !== undefined
      ? Object.fromEntries(
          Object.entries(patch.categoryLimits).filter(([, v]) => v != null && (v as number) > 0)
        )
      : activeRules.categoryLimits,
  };
  return activeRules;
}

export function resetRules(): RuleSet {
  activeRules = { ...DEFAULT_RULES, categoryLimits: {} };
  return activeRules;
}
```

---

## 3. Merchant normalization (`src/lib/merchants.ts`)

```ts
import type { Category } from "./contract";

// Deterministic alcohol backstop — word-bounded to avoid "Republic", "publix"
export const ALCOHOL_REGEX =
  /\b(LCBO|SAQ|liquor|brewery|brewing|winery|cellars|taproom|distillery)\b/i;

const BRAND_CANON: [RegExp, string][] = [
  [/^AMZN|^AMAZON/, "AMAZON"],
  [/^WAL-MART|^WALMART/, "WALMART"],
  [/^COSTCO/, "COSTCO"],
  [/^EBAY/, "EBAY"],
  [/^TARGET/, "TARGET"],
];

export function normalizeMerchant(raw: string): string {
  let s = raw.trim().toUpperCase();
  s = s.replace(/\*.*$/, "").trim();                         // strip order codes
  s = (s.replace(/\s+\d{7,}.*$/, "").trim()) || s;          // strip long phone/acct numbers
  s = s.replace(/\s*#\d+.*$/, "").trim();                   // strip #0687 INSIDE
  s = s.replace(/\s+\d{3}-\d{3}-\d{4}.*$/, "").trim();     // strip dashed phone
  s = (s.replace(/\s+\d{2,}[A-Z-]*$/, "").trim()) || s;    // strip trailing location IDs
  s = s.replace(/\bINSIDE$/, "").trim();
  s = s.replace(/\s+\b(INC|LLC|LTD|CO)\.?\b\s*$/, "").trim();
  for (const [re, canon] of BRAND_CANON) {
    if (re.test(s)) return canon;
  }
  return s;
}

export const CATEGORY_LIST: Category[] = [
  "fuel","permits_gov","vehicle_maintenance","supplies","tolls","telecom","digital",
  "transport","parking","car_rental","lodging","airfare","meal","alcohol","marketplace","other",
];

export function buildCategorizationPrompt(
  normalizedMerchant: string,
  rawMerchant: string,
  mcc: string | null,
  medianAmount: number,
): string {
  return `You assign ONE expense category to a corporate-card merchant. Use the merchant
name as primary evidence and the MCC as a weak hint (MCCs are often wrong or
generic). Return exactly one category from this list:

  fuel              gas stations, truck stops, fuel
  permits_gov       government permits, DOT, customs/border, weigh stations
  vehicle_maintenance  repair, tires, parts, towing, wash
  supplies          office/industrial supplies, hardware
  tolls             toll roads/bridges
  telecom           phone, mobile, internet service
  digital           software, SaaS, cloud, subscriptions (Adobe, QuickBooks, SiriusXM)
  transport         taxi, rideshare, transit, courier (non-fuel)
  parking           parking lots/garages/meters
  car_rental        rental cars
  lodging           hotels, motels
  airfare           airlines, flights
  meal              restaurants, cafes, food delivery, bars used for dining
  alcohol           liquor stores, breweries, wineries, standalone bars
  marketplace       general everything-stores (Amazon, Walmart, eBay, Costco, big-box)
  other             genuinely none of the above

MERCHANT: ${normalizedMerchant}
RAW NAME: ${rawMerchant}
MCC: ${mcc ?? "null"}
TYPICAL AMOUNT: ${medianAmount.toFixed(2)} CAD

Rules:
- "marketplace" beats a specific guess when the merchant sells many unrelated
  categories and you cannot tell what was bought.
- "alcohol" only for STANDALONE alcohol merchants. A restaurant is "meal".
- Permit/customs/weigh-station vendors are "permits_gov" even with a generic MCC.

Return ONLY: {"category": "<one value>", "confidence": 0.0, "reasoning": "<short>"}`;
}
```

---

## 4. MCC → category mapping (`src/lib/parseTransactions.ts` — key section)

```ts
const MCC_TO_CATEGORY: Record<string, Category> = {
  "5541": "fuel", "5542": "fuel",
  "9399": "permits_gov",
  "7542": "vehicle_maintenance", "7538": "vehicle_maintenance",
  "5533": "vehicle_maintenance", "5532": "vehicle_maintenance", "5561": "vehicle_maintenance",
  "5085": "supplies", "5046": "supplies", "5200": "supplies", "5300": "supplies", "5251": "supplies",
  "4784": "tolls",
  "4812": "telecom", "4814": "telecom",
  "4816": "digital",
  "5947": "marketplace",   // gift/novelty → item unknown
  "4121": "transport",
  "4511": "airfare",
  "7011": "lodging",
  "7512": "car_rental",
  "7523": "parking",
  // 5812/5814 (meal) and 5813/5921 (alcohol) intentionally absent —
  // they stay "other" from the parser; preprocess_categories.ts assigns them via LLM.
};

// Handles airline block (3000–3299) and auto-rental block (3351–3441).
function mccCategory(mcc: string | null): Category {
  if (!mcc) return "other";
  const n = parseInt(mcc, 10);
  if (n >= 3000 && n <= 3299) return "airfare";
  if (n >= 3351 && n <= 3441) return "car_rental";
  return MCC_TO_CATEGORY[mcc] ?? "other";
}
```

---

## 5. Context-sensitive set (`src/lib/categorize.ts` — key constants)

```ts
// Categories that need LLM compliance judgment (PENDING_CONTEXT pass).
// marketplace is NOT here — it uses a plain dollar cap, not a receipt request.
export const CONTEXT_SENSITIVE = new Set(["meal", "alcohol"]);
```

---

## 6. The crux — `evaluate()` (`src/lib/categorize.ts`)

This is the most critical piece. Read carefully.

```ts
export async function evaluate(txn: Transaction, rules: RuleSet): Promise<EvalResult> {
  // Use the LLM-assigned category baked in at preprocess time — do NOT re-derive from MCC.
  let cat: string = txn.category;
  let classification: Classification | null = null;

  const isMeal = cat === "meal";
  const runContext = isMeal ? rules.enableMealContext : true;

  if (CONTEXT_SENSITIVE.has(cat) && runContext) {
    classification = await classifyWithGemini(txn);
    if (classification?.policy_category) cat = classification.policy_category;
  }

  const findings: Finding[] = [];

  if (rules.preauthThreshold > 0 && txn.amount > rules.preauthThreshold) {
    findings.push({ type: "NEEDS_PREAUTH", severity: 0.2 });
  }

  // ── THE CRUX ────────────────────────────────────────────────────────────────
  // When requires_context is true → emit PENDING_CONTEXT and BLOCK CATEGORY_LIMIT.
  // We request the receipt / guest list. We do NOT fabricate the answer.
  // Example: a $200 restaurant charge with no attendee info → PENDING_CONTEXT, never CATEGORY_LIMIT.
  if (classification?.requires_context && runContext) {
    findings.push({
      type: "PENDING_CONTEXT",
      severity: 0.3,
      missing: classification.missing_context,
      reasoning: classification.reasoning,
    });
    // DO NOT add CATEGORY_LIMIT here — we cannot evaluate the limit without context.
  } else {
    // Only apply the cap when we know what the category is.
    const limit =
      rules.categoryLimits[cat as keyof typeof rules.categoryLimits] ??
      (isMeal || cat.startsWith("meal")
        ? rules.categoryLimits["meal" as keyof typeof rules.categoryLimits]
        : undefined);
    if (limit != null && limit > 0 && txn.amount > limit) {
      findings.push({ type: "CATEGORY_LIMIT", severity: 0.5 });
    }
  }

  if (classification?.is_reimbursable === false) {
    findings.push({ type: "NON_REIMBURSABLE", severity: 0.7, clause: classification.policy_clause });
  }

  return { category: cat, confidence: classification?.confidence ?? 1.0, findings };
}
```

**Compliance prompt sent to Gemini** (inside `classifyWithGemini`):
```
You classify a single corporate-card transaction against the Brim expense policy.
You do NOT have line items, attendees, or receipts unless they appear below.
Never assume facts you were not given.

POLICY (relevant clauses):
- Meals: expenses over $50 require pre-authorization and a receipt.
- Alcohol is reimbursable ONLY when dining with a customer; guest names and
  business purpose must be recorded. Otherwise alcohol is not reimbursable.
- Tips: up to 15% (service) / 20% (meals). Verifiable only from a receipt.
- Personal charges and personal-vehicle insurance are NOT reimbursable.

TRANSACTION:
  merchant: {{merchant}}
  amount: {{amount}} CAD
  mcc: {{mcc}}  (candidate category: {{mcc_category}})
  date/time: {{date}} ({{weekday}})
  city: {{city}}
  memo/attendees/purpose: null

Return ONLY this JSON — no prose, no markdown, no code fences:
{
  "policy_category": "meal_solo | meal_client | alcohol | car_insurance_personal | personal | other",
  "is_reimbursable": true | false | null,
  "requires_context": true | false,
  "missing_context": [],
  "confidence": 0.0,
  "policy_clause": "...",
  "reasoning": "one sentence"
}

Rules:
- Restaurant charge with no attendee/purpose info → policy_category "meal_client",
  requires_context true, missing_context ["guest_names","business_purpose"],
  is_reimbursable null. Do NOT mark it a violation.
- Standalone alcohol/bar with no customer context → is_reimbursable false.
- Marketplace / general-merchandise charge → requires_context true,
  missing_context ["itemized_receipt"], is_reimbursable null.
```

---

## 7. Compliance engine key logic (`src/lib/compliance.ts`)

### `overPreauth` — the 0-cap guard and suppression rule
```ts
function overPreauth(spend: Transaction[], rules: RuleSet): Violation[] {
  const limit = rules.preauthThreshold;
  if (limit === 0) return [];   // 0 = rule disabled
  return spend
    .filter((t) => {
      if (t.amount <= limit) return false;
      // Suppress when category already has a dedicated limit — that IS the policy for this category.
      const cap = rules.categoryLimits[t.category as keyof typeof rules.categoryLimits];
      if (cap !== undefined && cap > 0) return false;
      return true;
    })
    .map((t) => ({ txn: t, ruleId: "OVER_PREAUTH", severity: ... }));
}
```

### `categoryLimit` — the 0-guard (critical bug fix)
```ts
function categoryLimit(spend: Transaction[], rules: RuleSet): Violation[] {
  const out: Violation[] = [];
  for (const t of spend) {
    const cap = rules.categoryLimits[t.category];
    // cap > 0 check is REQUIRED — cap === 0 would flag every transaction > $0
    if (cap !== undefined && cap > 0 && t.amount > cap) {
      out.push({ txn: t, ruleId: "CATEGORY_LIMIT", severity: cap > 0 && t.amount > cap * 2 ? 2 : 1, ... });
    }
  }
  return out;
}
```

### `applyContextualRules` — filters using `t.category`, not MCC re-lookup
```ts
export async function applyContextualRules(allTxns, rules) {
  const spend = allTxns.filter((t) => t.isSpend);
  // Use t.category (LLM-assigned at preprocess) — NOT mccToCategory() re-lookup.
  const contextTxns = spend.filter((t) => CONTEXT_SENSITIVE.has(t.category));
  // ... call evaluate() for each, map findings to Violation[], return
}
```

---

## 8. One-time preprocess sequence

```bash
# 1. Parse xlsx → dataset.json (MCC categories as starting point)
npx tsx scripts/preprocess.ts

# 2. LLM-categorize all ~600 distinct merchants → update dataset.json + write cache
#    Takes ~2 min. Re-run is incremental (only new merchants hit the LLM).
npx tsx scripts/preprocess_categories.ts
```

`preprocess_categories.ts` logic:
1. Load `dataset.json`
2. Group `isSpend` transactions by `normalizeMerchant(t.merchant)` → ~600 distinct keys
3. Apply `ALCOHOL_REGEX` deterministically (no LLM for obvious cases)
4. Call Gemini for each remaining merchant (batch 20 at a time, 300ms between batches)
5. Write `merchant_categories.json` (the cache) and update `t.category` in `dataset.json`

After this, **zero LLM calls are needed at runtime for categorization** — categories
are baked into `dataset.json`. The compliance LLM (`evaluate()`) only runs for
meal/alcohol rows at scan time, and its results are cached by `transaction_id`.

---

## 9. API routes

### `GET /api/violations`
```ts
const rules = getRules();
const [base, contextual] = await Promise.all([
  Promise.resolve(findViolations(transactions, rules)),
  applyContextualRules(transactions, rules),
]);
const violations = mergeViolationSets(base, contextual).map((v) => ({
  ...v,
  narration: violationNarration(v.ruleId, v.severity, v.txn.merchant),
}));
return { violations, repeatOffenders, count, rules };
```

### `POST /api/rules`
Accepts partial `RuleSet` patch. Strips zero/blank category limits on the way in.
Returns `{ rules, violationCount }` — the UI re-renders immediately without a second fetch.

---

## 10. UI — rules editor and violations panel

**CATEGORIES array** (dollar-limit inputs only):
```ts
const CATEGORIES = [
  "fuel","permits_gov","vehicle_maintenance","supplies","tolls","telecom","digital","transport",
  "parking","car_rental","lodging","airfare","meal","marketplace",
] as const;
// alcohol: excluded — policy flag only, not a dollar limit
// other: excluded — internal fallback, would cap a meaningless grab-bag
// meal_solo / meal_client / tips_gratuity: excluded — removed from taxonomy
```

**Key UX rules:**
- All rule defaults are OFF. User opts in to each rule explicitly.
- Threshold `0` = rule disabled (not "flag everything"). Guard this in the engine.
- Category limit `0` or blank = no limit. Strip on save (`setRules`).
- When a category limit is saved, auto-filter the violations panel to `CATEGORY_LIMIT`
  so the user sees only what they configured, not all 3k+ violations from other rules.
- `PENDING_CONTEXT` badge is purple and labelled "pending" — it is a receipt REQUEST,
  not an alert/violation.

**Violation badge logic:**
```ts
if (ruleId === "PENDING_CONTEXT") → purple "pending" badge
if (ruleId === "NON_REIMBURSABLE") → red "not reimbursable" badge
severity 0 → green "info"
severity 1 → yellow "warning"
severity 2 → red "alert"
```

---

## 11. Dependencies

```bash
npm i openai better-sqlite3 xlsx
npm i -D @types/better-sqlite3 tsx dotenv
```

`.env.local`:
```
GEMINI_API_KEY=<bearer token>
GEMINI_BASE_URL=https://api.tokenrouter.com/v1
```
