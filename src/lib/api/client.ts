/**
 * lib/api/client.ts
 * The ONLY place browser network calls live. Each route is wrapped behind a discriminated
 * ApiResult so a caller never has to catch a throw or handle an unhandled rejection — the
 * UI can always render something, even on failure. Response types are imported from the
 * contract (and assembled from contract types); nothing here redefines a shape.
 */
import type { QueryResult, Violation, ExpenseReport, ApprovalItem } from "@/lib/contract";
import type { RuleSet } from "@/lib/rules";

// Discriminated result. `aborted` flags a request cancelled by an AbortSignal (a newer
// question superseding an in-flight one) so the caller can stay silent rather than show
// an error toast.
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; aborted?: boolean };

// Shapes the routes return, assembled from contract types (not redefined). transactionCount
// / spendCount come from the violations route's additive overview fields.
export interface ViolationsResponse {
  violations: Violation[];
  repeatOffenders: { merchant: string; count: number }[];
  count: number;
  transactionCount: number;
  spendCount: number;
  rules?: RuleSet;
}

export interface RulesResponse {
  rules: RuleSet;
}

export interface SetRulesResponse {
  rules: RuleSet;
  violationCount: number;
}
export interface ReportsResponse {
  reports: ExpenseReport[];
  count: number;
}
export interface ApprovalsResponse {
  items: ApprovalItem[];
  count: number;
}

// Pull an { error } message out of a non-2xx JSON body; falls back to a generic line if
// the body is empty or unparseable. Never throws.
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // body was empty or not JSON — fall through to the generic message
  }
  return fallback;
}

/**
 * POST /api/gemini — talk-to-data. Returns a QueryResult on success. The optional
 * AbortSignal lets a newer question cancel this one; an AbortError comes back as
 * { ok:false, aborted:true } so the caller can ignore it silently instead of erroring.
 */
export async function askData(question: string, history: string, signal?: AbortSignal): Promise<ApiResult<QueryResult>> {
  let res: Response;
  try {
    res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
      signal,
    });
  } catch (err) {
    // Network rejection OR abort. Abort is a silent cancel, not a real error.
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "cancelled", aborted: true };
    }
    return { ok: false, error: "The keeper could not be reached." };
  }
  // Non-2xx: read the route's { error } message.
  if (!res.ok) return { ok: false, error: await readError(res, "The keeper could not read the ledger just now.") };
  // Guard the success parse too: a 200 with a truncated/non-JSON body must not crash.
  try {
    return { ok: true, data: (await res.json()) as QueryResult };
  } catch {
    return { ok: false, error: "The keeper's answer was unreadable." };
  }
}

/** GET /api/violations — the ranked policy flags, repeat offenders, and dataset totals. */
export async function getViolations(): Promise<ApiResult<ViolationsResponse>> {
  let res: Response;
  try {
    res = await fetch("/api/violations", { method: "GET" });
  } catch {
    return { ok: false, error: "Could not reach the ledger." };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Could not scan the ledger.") };
  try {
    return { ok: true, data: (await res.json()) as ViolationsResponse };
  } catch {
    return { ok: false, error: "The ledger's flags were unreadable." };
  }
}

/** GET /api/reports — trip-clustered expense reports. */
export async function getReports(): Promise<ApiResult<ReportsResponse>> {
  let res: Response;
  try {
    res = await fetch("/api/reports", { method: "GET" });
  } catch {
    return { ok: false, error: "Could not reach the ledger." };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Could not assemble the reports.") };
  try {
    return { ok: true, data: (await res.json()) as ReportsResponse };
  } catch {
    return { ok: false, error: "The reports were unreadable." };
  }
}

/** GET /api/approvals — the pre-approval queue: charges needing sign-off with AI reasoning. */
export async function getApprovals(): Promise<ApiResult<ApprovalsResponse>> {
  let res: Response;
  try {
    res = await fetch("/api/approvals", { method: "GET" });
  } catch {
    return { ok: false, error: "Could not reach the ledger." };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Could not assemble the approvals.") };
  try {
    return { ok: true, data: (await res.json()) as ApprovalsResponse };
  } catch {
    return { ok: false, error: "The approvals were unreadable." };
  }
}

/** GET /api/rules — the active RuleSet. */
export async function fetchRules(): Promise<ApiResult<RulesResponse>> {
  let res: Response;
  try {
    res = await fetch("/api/rules", { method: "GET" });
  } catch {
    return { ok: false, error: "Could not reach the ledger." };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Could not fetch the rules.") };
  try {
    return { ok: true, data: (await res.json()) as RulesResponse };
  } catch {
    return { ok: false, error: "The rules were unreadable." };
  }
}

/** POST /api/rules — patch the RuleSet. Returns updated rules + new violation count. */
export async function saveRules(patch: Partial<RuleSet>): Promise<ApiResult<SetRulesResponse>> {
  let res: Response;
  try {
    res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    return { ok: false, error: "Could not reach the ledger." };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Could not save the rules.") };
  try {
    return { ok: true, data: (await res.json()) as SetRulesResponse };
  } catch {
    return { ok: false, error: "The rules response was unreadable." };
  }
}

/**
 * POST /api/voice — ElevenLabs TTS proxy. On success returns the audio Blob (audio/mpeg);
 * on a non-2xx it reads the JSON { error }. The caller turns the Blob into an object URL.
 */
export async function speak(text: string): Promise<ApiResult<Blob>> {
  let res: Response;
  try {
    res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    return { ok: false, error: "The keeper's voice could not be reached." };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Voice generation failed.") };
  try {
    return { ok: true, data: await res.blob() };
  } catch {
    return { ok: false, error: "The keeper's voice was unreadable." };
  }
}
