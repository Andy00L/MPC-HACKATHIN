/**
 * gemini/parse.ts
 * Tiny shared helpers for reading the model's structured (json_object) replies. Both the
 * talk-to-data bridge (the route) and the approval reasoning (approve.ts) use these, so the
 * fence-stripping and the severity clamping live in exactly one place.
 */
import type { Severity } from "../contract";

// Strip a ```json ... ``` (or bare ```) fence if the model wrapped its JSON in one, so the
// caller's JSON.parse sees clean JSON. Returns the input unchanged when it is not fenced.
export function stripFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

// Clamp any model-returned value into the contract's 0|1|2 severity. Anything out of range,
// missing, or non-numeric degrades to 0 (the calm face) rather than leaking through.
export function clampSeverity(value: unknown): Severity {
  const rounded = Math.round(Number(value));
  return rounded === 1 || rounded === 2 ? (rounded as Severity) : 0;
}
