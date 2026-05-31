/**
 * hooks/usePolicyEngine.ts
 * Drives the Policy chapter (Feature 2). Lazily fetches the active rules and the
 * violations that result from them when the chapter is first opened. updateRules posts
 * a new rule patch, gets back the updated rules and violation count, then re-fetches
 * the full violations list so the right-page panel stays in sync.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Violation } from "@/lib/contract";
import type { RuleSet } from "@/lib/rules";
import { DEFAULT_RULES } from "@/lib/rules";
import { fetchRules, saveRules, getViolations } from "@/lib/api/client";

export interface PolicyState {
  rules: RuleSet;
  violations: Violation[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  updateRules: (patch: Partial<RuleSet>) => Promise<void>;
}

export function usePolicyEngine(active: boolean): PolicyState {
  const [rules, setRulesState] = useState<RuleSet>(DEFAULT_RULES);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // Lazy fetch: load rules + violations the first time the chapter opens.
  useEffect(() => {
    if (!active || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);

    Promise.all([fetchRules(), getViolations()]).then(([rulesResult, violationsResult]) => {
      if (rulesResult.ok) setRulesState(rulesResult.data.rules);
      if (violationsResult.ok) {
        setViolations(violationsResult.data.violations);
        // Violations route also returns the active rules — use whichever loaded last.
        if (violationsResult.data.rules) setRulesState(violationsResult.data.rules);
      }
      if (!rulesResult.ok && !violationsResult.ok) {
        setError(!violationsResult.ok ? violationsResult.error : rulesResult.error);
      }
      setLoading(false);
    });
  }, [active]);

  const updateRules = useCallback(async (patch: Partial<RuleSet>) => {
    setSaving(true);
    setError(null);
    const result = await saveRules(patch);
    if (result.ok) {
      setRulesState(result.data.rules);
      // Re-fetch the full violations list under the new rules.
      const violationsResult = await getViolations();
      if (violationsResult.ok) setViolations(violationsResult.data.violations);
    } else {
      setError(result.error);
    }
    setSaving(false);
  }, []);

  return { rules, violations, loading, saving, error, updateRules };
}
