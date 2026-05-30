/**
 * gemini/schemas.ts
 * JSON-schema objects passed to Gemini via config.responseSchema, so the model
 * returns parseable JSON instead of prose. Enums must match the contract exactly.
 */

// Step 1 of talk-to-data: Gemini maps the question to a query plan.
export const queryPlanSchema = {
  type: "object",
  properties: {
    operation: {
      type: "string",
      enum: ["spendByCategory", "spendByMerchant", "spendOverTime", "totalSpend", "filterList"],
    },
    category: {
      type: "string",
      enum: [
        "fuel",
        "permits_gov",
        "vehicle_maintenance",
        "supplies",
        "tolls",
        "telecom",
        "digital",
        "gift_card",
        "transport",
        "other",
        "all",
      ],
    },
    startDate: { type: "string" }, // ISO yyyy-mm-dd, or empty
    endDate: { type: "string" }, // ISO yyyy-mm-dd, or empty
    minAmount: { type: "number" }, // 0 means no floor
    timeBucket: { type: "string", enum: ["day", "week", "month", "none"] },
    chartKind: { type: "string", enum: ["bar", "line", "donut", "none"] },
  },
  required: ["operation", "category", "chartKind"],
};

// Step 3 of talk-to-data: Gemini narrates the computed result in character.
export const narrationSchema = {
  type: "object",
  properties: {
    answerText: { type: "string" }, // plain-language answer
    narration: { type: "string" }, // the keeper's spoken line
    severity: { type: "integer", enum: [0, 1, 2] },
  },
  required: ["answerText", "narration", "severity"],
};

// Pre-approval (Feature 3): Gemini returns a recommendation and reasoning.
export const approvalSchema = {
  type: "object",
  properties: {
    recommendation: { type: "string", enum: ["approve", "deny"] },
    reasoning: { type: "string" },
    severity: { type: "integer", enum: [0, 1, 2] },
  },
  required: ["recommendation", "reasoning", "severity"],
};
