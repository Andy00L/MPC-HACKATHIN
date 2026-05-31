/**
 * hooks/useReviewQueue.ts
 * Drives chapter 4 (the violations review queue) over the real Violation[] from
 * useLedgerData. Decisions live in memory only (React state) — no localStorage or any
 * browser storage, which is unsupported in this context.
 *
 * Keyboard (only while `enabled`, e.g. on the violations chapter): A/D/E decide, Z undoes,
 * ArrowLeft/ArrowRight navigate without deciding. Keystrokes are ignored while the user is
 * typing in an input/textarea so the ask field never triggers a decision.
 *
 * Edge cases: empty queue (done = true immediately → UI shows "no flags"), reaching the
 * end (done = true → UI shows the decision summary), undo at index 0 (no-op).
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Violation } from "@/lib/contract";

export type Decision = "approved" | "dismissed" | "escalated";

export interface ReviewQueue {
  items: Violation[];
  currentIndex: number;
  current: Violation | null;
  decisions: Record<string, Decision>;
  done: boolean;
  counts: { approved: number; dismissed: number; escalated: number; decided: number };
  approve: () => void;
  dismiss: () => void;
  escalate: () => void;
  undo: () => void;
  next: () => void;
  prev: () => void;
}

export function useReviewQueue(violations: Violation[], enabled = true): ReviewQueue {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [history, setHistory] = useState<string[]>([]); // txn ids in decision order, for undo

  // Reset when the underlying list changes (e.g. data arrives after mount).
  useEffect(() => {
    setCurrentIndex(0);
    setDecisions({});
    setHistory([]);
  }, [violations]);

  // Refs let the action callbacks stay stable while always reading the latest values.
  const indexRef = useRef(currentIndex);
  indexRef.current = currentIndex;
  const historyRef = useRef(history);
  historyRef.current = history;

  const total = violations.length;
  const done = total === 0 || currentIndex >= total;
  const current = !done ? violations[currentIndex] : null;

  // Record a decision for the current item and advance. No-op once past the end.
  const decide = useCallback(
    (decision: Decision) => {
      const index = indexRef.current;
      if (index >= violations.length) return;
      const id = violations[index].txn.id;
      setDecisions((prev) => ({ ...prev, [id]: decision }));
      setHistory((prev) => [...prev, id]);
      setCurrentIndex(index + 1);
    },
    [violations],
  );

  const approve = useCallback(() => decide("approved"), [decide]);
  const dismiss = useCallback(() => decide("dismissed"), [decide]);
  const escalate = useCallback(() => decide("escalated"), [decide]);

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

  // Navigate without deciding (clamped to the [0, total] range; total === the summary).
  const next = useCallback(() => setCurrentIndex((index) => Math.min(total, index + 1)), [total]);
  const prev = useCallback(() => setCurrentIndex((index) => Math.max(0, index - 1)), []);

  const counts = useMemo(() => {
    let approved = 0;
    let dismissed = 0;
    let escalated = 0;
    for (const decision of Object.values(decisions)) {
      if (decision === "approved") approved += 1;
      else if (decision === "dismissed") dismissed += 1;
      else escalated += 1;
    }
    return { approved, dismissed, escalated, decided: approved + dismissed + escalated };
  }, [decisions]);

  // Keyboard shortcuts — attached only while enabled (i.e. on the violations chapter).
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      // Ignore keystrokes while the user is typing, so the ask field can't fire actions.
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
          dismiss();
          break;
        case "e":
          escalate();
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
          return; // leave other keys alone
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, approve, dismiss, escalate, undo, next, prev]);

  return { items: violations, currentIndex, current, decisions, done, counts, approve, dismiss, escalate, undo, next, prev };
}
