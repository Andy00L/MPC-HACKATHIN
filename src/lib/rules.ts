import type { Category } from "./contract";

export interface RuleSet {
  preauthThreshold: number;      // 0 = rule disabled
  splitThreshold: number;        // 0 = rule disabled
  categoryLimits: Partial<Record<Category, number>>;
  flagForeignTransactions: boolean;
  enableAnomaly: boolean;
  enableDuplicate: boolean;
  enableAlcohol: boolean;
  enableMealContext: boolean;    // when false: skip PENDING_CONTEXT pass for meals
}

// All defaults match the existing hardcoded behavior so ch4 continues to work.
export const DEFAULT_RULES: RuleSet = {
  preauthThreshold: 50,
  splitThreshold: 50,
  categoryLimits: {},
  flagForeignTransactions: false,
  enableAnomaly: true,
  enableDuplicate: true,
  enableAlcohol: true,
  enableMealContext: false,
};

let activeRules: RuleSet = { ...DEFAULT_RULES, categoryLimits: {} };

export function getRules(): RuleSet { return activeRules; }

export function setRules(patch: Partial<RuleSet>): RuleSet {
  activeRules = {
    ...activeRules,
    ...patch,
    // Full replace so clearing a limit actually clears it. Strip zero/blank entries.
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
