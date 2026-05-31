/**
 * components/ledger/severity.ts
 * The ONE seam between the engine's numeric Severity (0|1|2) and the keeper's mood
 * string. It lives in exactly this module so the face, the SevBadge, the dialog dot,
 * and the voice tone can never disagree about what a given severity means.
 */
import type { Severity } from "@/lib/contract";
import type { Mood } from "./tokens";

// Index 0 -> neutral, 1 -> concerned, 2 -> alarmed. Order matters: it mirrors Severity.
const MOODS = ["neutral", "concerned", "alarmed"] as const;

/**
 * Maps the engine's numeric severity to the keeper's mood. The index is exhaustive over
 * the 0|1|2 union; the `?? "neutral"` is a defensive guard so an out-of-range value
 * (e.g. a malformed API payload) degrades to the calm face instead of `undefined`.
 */
export function severityToMood(severity: Severity): Mood {
  return MOODS[severity] ?? "neutral";
}
