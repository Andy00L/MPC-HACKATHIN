/**
 * gemini/schemas.ts
 * The JSON shapes the structured calls must return (the narration bridge and the approval
 * reasoning). The proxy's Gemini backend rejects response_format json_schema, so we do NOT
 * send these as a schema parameter; instead each caller sends
 * response_format: { type: "json_object" } and embeds the relevant shape (stringified) in
 * its prompt. Keeping the shapes here makes them the single source of the expected fields.
 * severity is a bounded integer (minimum/maximum 0..2) rather than an enum, because the
 * proxy/model rejects an integer enum on that field.
 */

// The narration bridge: the persona call returns the keeper's answer text, spoken line,
// and a severity, built from the agent's prose answer and a small sample of the SQL rows.
export const narrationSchema = {
  type: "object",
  properties: {
    answerText: { type: "string" }, // plain-language answer
    narration: { type: "string" }, // the keeper's spoken line
    severity: { type: "integer", minimum: 0, maximum: 2 },
  },
  required: ["answerText", "narration", "severity"],
};

// Pre-approval (Feature 3): Gemini returns a recommendation and reasoning.
export const approvalSchema = {
  type: "object",
  properties: {
    recommendation: { type: "string", enum: ["approve", "deny"] },
    reasoning: { type: "string" },
    severity: { type: "integer", minimum: 0, maximum: 2 },
  },
  required: ["recommendation", "reasoning", "severity"],
};
