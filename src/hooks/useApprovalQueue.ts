/**
 * hooks/useApprovalQueue.ts
 * Drives the Pre-Approval chapter (Feature 3). It LAZILY fetches /api/approvals the first
 * time the chapter is opened (the route runs a model call per item, so we never pay for it
 * on page load), then runs an approve/deny review queue over the result. Decisions live in
 * memory only (no storage). Keyboard while active: A approves, D denies, Z undoes,
 * ArrowLeft/ArrowRight navigate; keystrokes are ignored while the user is typing in an
 * input so the ask field never triggers a decision.
 *
 * This mirrors useReviewQueue's shape, with two differences: the decision is binary
 * (approve/deny, matching the AI recommendation), and the items are fetched here rather
 * than passed in.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalItem } from "@/lib/contract";
import { getApprovals } from "@/lib/api/client";

export type ApprovalDecision = "approved" | "denied";

export interface ApprovalQueue {
  items: ApprovalItem[];
  loading: boolean;
  error: string | null;
  currentIndex: number;
  current: ApprovalItem | null;
  decisions: Record<string, ApprovalDecision>;
  done: boolean;
  counts: { approved: number; denied: number; decided: number };
  approve: () => void;
  deny: () => void;
  undo: () => void;
  next: () => void;
  prev: () => void;
}

export function useApprovalQueue(active: boolean): ApprovalQueue {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({});
  const [history, setHistory] = useState<string[]>([]); // txn ids in decision order, for undo
  const fetchedRef = useRef(false);

  // Lazy fetch: the first time the chapter becomes active, load the queue exactly once.
  useEffect(() => {
    if (!active || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    getApprovals().then((result) => {
      if (result.ok) {
        setItems(result.data.items);
        setError(null);
      } else if (!result.aborted) {
        setError(result.error);
      }
      setLoading(false);
    });
  }, [active]);

  // Refs let the action callbacks stay stable while always reading the latest values.
  const indexRef = useRef(currentIndex);
  indexRef.current = currentIndex;
  const historyRef = useRef(history);
  historyRef.current = history;

  const total = items.length;
  const done = total === 0 || currentIndex >= total;
  const current = !done ? items[currentIndex] : null;

  // Record a decision for the current item and advance. No-op once past the end.
  const decide = useCallback(
    (decision: ApprovalDecision) => {
      const index = indexRef.current;
      if (index >= items.length) return;
      const id = items[index].txn.id;
      setDecisions((prev) => ({ ...prev, [id]: decision }));
      setHistory((prev) => [...prev, id]);
      setCurrentIndex(index + 1);
    },
    [items],
  );

  const approve = useCallback(() => decide("approved"), [decide]);
  const deny = useCallback(() => decide("denied"), [decide]);

  // Pop the last decision and step back. Boundary (no history) is a no-op.
  const undo = useCallback(() => {
    const hist = historyRef.current;
    if (hist.length === 0) return;
    const lastId = hist[hist.length - 1];
    setHistory(hist.slice(0, -1));
    setDecisions((prev) => {
      const copy = { ...prev };
      delete copy[lastId];
      return copy;
    });
    setCurrentIndex((index) => Math.max(0, index - 1));
  }, []);

  // Navigate without deciding (clamped to [0, total]; total === the summary view).
  const next = useCallback(() => setCurrentIndex((index) => Math.min(total, index + 1)), [total]);
  const prev = useCallback(() => setCurrentIndex((index) => Math.max(0, index - 1)), []);

  const counts = useMemo(() => {
    let approved = 0;
    let denied = 0;
    for (const decision of Object.values(decisions)) {
      if (decision === "approved") approved += 1;
      else denied += 1;
    }
    return { approved, denied, decided: approved + denied };
  }, [decisions]);

  // Keyboard shortcuts, attached only while the chapter is active.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      switch (event.key.toLowerCase()) {
        case "a":
          approve();
          break;
        case "d":
          deny();
          break;
        case "z":
          undo();
          break;
        case "arrowright":
          next();
          break;
        case "arrowleft":
          prev();
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, approve, deny, undo, next, prev]);

  return { items, loading, error, currentIndex, current, decisions, done, counts, approve, deny, undo, next, prev };
}
