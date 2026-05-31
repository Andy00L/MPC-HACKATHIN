/**
 * components/ledger/chapters.tsx
 * Chapter content (the requirement "frames"). Each chapter is one spread: a left (Voice)
 * page with the kicker/title + KPIs, and a right (Ledger) page with the view that flips.
 * Ported from roam-chapters.jsx, then HYDRATED: every number/chart now comes from the
 * live LedgerView (useLedgerData + useReviewQueue + the active ask answer), never from the
 * wireframe's placeholder literals ($52,140 / 41% / the invented $55,000 BestBuy card).
 *
 * renderLeft/renderRight are pure functions of (chapter, activeTarget, view); the
 * interactive review controls call the queue actions carried on view.queue directly.
 */
import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { QueryResult, Violation, Category } from "@/lib/contract";
import type { RuleSet } from "@/lib/rules";
import { WF, SERIES_COLORS } from "./tokens";
import { severityToMood } from "./severity";
import { Stat, Chip, SevBadge, ActionBtn } from "./primitives";
import { BarChart, TrendChart, LabeledTrendChart, DonutChart, DataTable } from "./charts";
import type { LedgerData } from "@/hooks/useLedgerData";
import type { ReviewQueue } from "@/hooks/useReviewQueue";
import type { ApprovalQueue } from "@/hooks/useApprovalQueue";
import type { ReportsState } from "@/hooks/useReports";
import type { PolicyState } from "@/hooks/usePolicyEngine";

// Everything the chapter renderers need, passed in so the pages stay pure.
export interface LedgerView {
  data: LedgerData;
  queue: ReviewQueue;
  approvals: ApprovalQueue; // the pre-approval queue (Feature 3), lazily fetched
  reports: ReportsState;    // the trip reports (Feature 4), lazily fetched
  policy: PolicyState;      // the policy compliance engine (Feature 2), lazily fetched
  mode: "story" | "ledger";
  answer: QueryResult | null; // the active ask answer — overrides the right page when set
  asking: boolean; // an ask is in flight
}

// ── formatting helpers ──
const fmtInt = (n: number): string => n.toLocaleString("en-US");
const money = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

// Single source of truth for the policy panel filter.
// OVER_PREAUTH is a compliance/receipt tally, NOT a suspicious flag. It fires on every
// routine fleet charge > $50 (~2,000+ rows) and must never flood the panel count.
// It is surfaced separately as an informational receipt-required note.
function policyDisplayed(violations: Violation[], rules: RuleSet): Violation[] {
  // Strip the pre-auth flood first.
  const suspicious = violations.filter((v) => v.ruleId !== "OVER_PREAUTH");
  const hasLimits = Object.keys(rules.categoryLimits).length > 0;
  if (!hasLimits) return suspicious;
  // When limits are set, narrow further to limit/contextual findings only.
  return suspicious.filter(
    (v) => v.ruleId === "CATEGORY_LIMIT" || v.ruleId === "PENDING_CONTEXT" || v.ruleId === "NON_REIMBURSABLE",
  );
}

// Human label for a rule id (the engine's stable ids -> plain language).
const RULE_LABEL: Record<string, string> = {
  OVER_PREAUTH: "Over the pre-authorization limit",
  GIFT_CARD: "Gift card on a corporate card",
  ALCOHOL: "Alcohol on a corporate card",
  DUPLICATE: "Duplicate charge",
  ANOMALY: "Anomalous amount",
  SPLIT: "Possible split transaction",
};
const humanRule = (ruleId: string): string => RULE_LABEL[ruleId] ?? "Flagged for review";

// ── POI: highlight wrapper the keeper points at ──
export function POI({ id, active, children, style }: { id: string; active: boolean; children: ReactNode; style?: CSSProperties }) {
  return (
    <div data-poi={id} style={{ position: "absolute", ...style }}>
      <div
        style={{
          position: "absolute",
          inset: -11,
          borderRadius: 10,
          pointerEvents: "none",
          border: active ? `2px dashed ${WF.gold}` : "2px dashed transparent",
          background: active ? "rgba(231,178,76,0.10)" : "transparent",
          boxShadow: active ? "0 0 0 4px rgba(231,178,76,0.10), 0 0 26px rgba(231,178,76,0.30)" : "none",
          transition: "all .35s",
          opacity: active ? 1 : 0,
        }}
      />
      {children}
    </div>
  );
}

const ChapterHead = ({ kicker, title }: { kicker: string; title: string }) => (
  <div style={{ position: "absolute", left: 70, top: 38 }}>
    <div style={{ fontFamily: WF.data, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 4 }}>{kicker}</div>
    <div style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 33, color: WF.ink, lineHeight: 1.02, maxWidth: 420 }}>{title}</div>
  </div>
);

const RightHead = ({ children }: { children: ReactNode }) => (
  <div style={{ fontFamily: WF.data, fontSize: 12, fontWeight: 600, color: WF.ink, marginBottom: 10, letterSpacing: 0.2 }}>{children}</div>
);

interface Kpi {
  value: ReactNode;
  label: string;
  accent?: string;
}

// Build the left-page KPIs for a chapter from live data. Returns [] for the cover.
function kpisFor(ch: number, view: LedgerView): Kpi[] {
  const { data, queue } = view;
  if (ch === 1) {
    return [
      { value: money(data.totalSpend), label: "Total spend · 6 mo" },
      { value: fmtInt(data.transactionCount), label: "Transactions" },
      // flagCount is now the suspicious set (OVER_PREAUTH excluded) — use ochre, not rust,
      // so a small honest number doesn't read as an emergency.
      { value: fmtInt(data.flagCount), label: "Worth a closer look", accent: WF.ochre },
    ];
  }
  if (ch === 2) {
    const top = data.categoryShare[0];
    const sum = data.categoryShare.reduce((total, point) => total + point.value, 0);
    const pct = top && sum > 0 ? Math.round((top.value / sum) * 100) : 0;
    return [
      { value: top ? `${pct}%` : "—", label: top ? `${top.label} — largest slice` : "Largest slice" },
      { value: top ? money(top.value) : "—", label: top ? `on ${top.label.toLowerCase()} alone` : "Top category" },
    ];
  }
  if (ch === 3) {
    const topVendor = data.topVendors[0];
    const repeatTop = data.repeatOffenders[0];
    return [
      { value: topVendor ? money(topVendor.value) : "—", label: topVendor ? `${topVendor.label} — top vendor` : "Top vendor" },
      { value: repeatTop ? `${repeatTop.count}×` : "—", label: repeatTop ? `flags · ${repeatTop.merchant}` : "Repeat offenders", accent: WF.rust },
    ];
  }
  if (ch === 4) {
    const flaggedValue = queue.items.reduce((total, violation) => total + violation.txn.amount, 0);
    return [
      { value: fmtInt(data.flagCount), label: "Open flags" },
      { value: money(flaggedValue), label: "Flagged value", accent: WF.rust },
    ];
  }
  if (ch === 5) {
    const approvalItems = view.approvals.items;
    const denyCount = approvalItems.filter((item) => item.recommendation === "deny").length;
    return [
      { value: fmtInt(approvalItems.length), label: "Charges awaiting sign-off" },
      { value: fmtInt(denyCount), label: "AI would deny", accent: WF.rust },
    ];
  }
  if (ch === 6) {
    const tripReports = view.reports.reports;
    const flagged = tripReports.reduce((total, report) => total + report.violations.length, 0);
    return [
      { value: fmtInt(tripReports.length), label: "Trips on the road" },
      { value: fmtInt(flagged), label: "Flags across trips", accent: WF.rust },
    ];
  }
  if (ch === 7) {
    const { violations: pv, rules: pr, loading: pl } = view.policy;
    // Use the same filter as PolicyRightPage so summary ≡ panel.
    const shown = pl ? [] : policyDisplayed(pv, pr);
    const flaggedValue = shown.reduce((sum, v) => sum + v.txn.amount, 0);
    return [
      { value: pl ? "…" : fmtInt(shown.length), label: "Flags under the ordinance", accent: WF.rust },
      { value: pl ? "…" : money(flaggedValue), label: "Flagged value", accent: WF.ochre },
    ];
  }
  return [];
}

// ── LEFT page per chapter ──
export function renderLeft(ch: number, activeTarget: string | null, view: LedgerView): ReactNode {
  if (ch === 0) {
    return (
      <div style={{ position: "absolute", left: 70, width: 430, top: 150 }}>
        <div style={{ fontFamily: WF.data, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 12 }}>Expense Intelligence</div>
        <div style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 50, lineHeight: 0.98, color: WF.ink }}>The Ledger of the Unknown</div>
        <div style={{ width: 54, height: 1.5, background: WF.sepia, margin: "20px 0" }} />
        <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 15, color: WF.inkSoft, lineHeight: 1.5 }}>
          Six months of fleet spending,
          <br />
          read aloud by the keeper who guards it.
        </div>
      </div>
    );
  }
  if (ch === 7) {
    const kpis = kpisFor(7, view);
    return (
      <>
        <ChapterHead kicker="Chapter VII · The Ordinance" title="The Edicts of Spending" />
        {/* No POI wrapper — the dashed amber highlight is distracting on a form chapter */}
        <div style={{ position: "absolute", left: 70, top: 128, display: "flex", gap: 22 }}>
          {kpis.map((kpi, i) => <Stat key={i} value={kpi.value} label={kpi.label} accent={kpi.accent ?? WF.ink} />)}
        </div>
        <PolicyLeftPage view={view} />
      </>
    );
  }

  const kpis = kpisFor(ch, view);
  const kicker = ["", "Chapter I · The Ledger", "Chapter II · The Map", "Chapter III · The Vendors", "Chapter IV · The Reckoning", "Chapter V · The Gatekeeper", "Chapter VI · The Roads"][ch] ?? "";
  const title = ["", "The Tale of the Months", "Where the Money Goes", "The Vendors", "The Reckoning", "Pre-Approval", "The Trips"][ch] ?? "";

  // ch4 gets a progress block below the KPIs so the left page isn't empty.
  const ch4Progress = ch === 4 && view.queue.items.length > 0 && (() => {
    const { queue } = view;
    const total = queue.items.length;
    const index = view.mode === "ledger" ? queue.currentIndex : 0;
    const { approved, dismissed, escalated } = queue.counts;
    const decided = approved + dismissed + escalated;
    return (
      <div style={{ position: "absolute", left: 70, top: 210, width: 480 }}>
        <div style={{ fontFamily: WF.data, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 8 }}>
          Progress
        </div>
        <div style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 26, color: WF.ink, marginBottom: 6 }}>
          {index + 1} <span style={{ fontFamily: WF.data, fontSize: 14, color: WF.inkSoft, fontWeight: 400 }}>of {fmtInt(total)}</span>
        </div>
        <div style={{ height: 6, background: WF.page2, borderRadius: 3, overflow: "hidden", border: `0.5px solid ${WF.sepiaSoft}`, marginBottom: 16 }}>
          <div style={{ width: `${total > 0 ? (index / total) * 100 : 0}%`, height: "100%", background: WF.pumpkin, transition: "width .3s" }} />
        </div>
        {decided > 0 && (
          <div style={{ display: "flex", gap: 22 }}>
            {approved > 0 && <Stat value={fmtInt(approved)} label="Approved" accent={WF.pine} />}
            {dismissed > 0 && <Stat value={fmtInt(dismissed)} label="Dismissed" />}
            {escalated > 0 && <Stat value={fmtInt(escalated)} label="Escalated" accent={WF.rust} />}
          </div>
        )}
        {decided === 0 && view.mode === "ledger" && (
          <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 13, color: WF.sepia }}>
            No decisions yet — approve, dismiss, or escalate each flag.
          </div>
        )}
        {view.mode !== "ledger" && (
          <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 13, color: WF.sepia }}>
            Switch to the Ledger ribbon to begin reviewing.
          </div>
        )}
      </div>
    );
  })();

  // ch2 gets a category-spend breakdown below the KPIs (moved here from ch1).
  const ch2CategoryBars = ch === 2 && view.data.categoryShare.length > 0 && (
    <div style={{ position: "absolute", left: 70, top: 205, width: 488 }}>
      <div style={{ fontFamily: WF.data, fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 9 }}>
        Spend by category
      </div>
      {view.data.categoryShare.slice(0, 9).map((cat, i) => {
        const maxVal = view.data.categoryShare[0].value;
        const pct = maxVal > 0 ? (cat.value / maxVal) * 100 : 0;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 100, fontFamily: WF.data, fontSize: 10, color: WF.inkSoft, flexShrink: 0, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {cat.label}
            </div>
            <div style={{ flex: 1, height: 9, background: WF.page2, borderRadius: 2, overflow: "hidden", border: `0.5px solid ${WF.sepiaSoft}` }}>
              <div style={{ width: `${pct}%`, height: "100%", background: i === 0 ? WF.pumpkin : WF.pine, opacity: i === 0 ? 0.85 : 0.7, transition: "width .4s" }} />
            </div>
            <div style={{ width: 68, fontFamily: WF.data, fontSize: 10, color: WF.ink, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              {money(cat.value)}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <ChapterHead kicker={kicker} title={title} />
      <POI id="kpis" active={activeTarget === "kpis"} style={{ left: 70, top: 128, width: ch === 1 ? 392 : 320 }}>
        <div style={{ display: "flex", gap: 22 }}>
          {kpis.map((kpi, index) => (
            <Stat key={index} value={kpi.value} label={kpi.label} accent={kpi.accent ?? WF.ink} />
          ))}
        </div>
      </POI>
      {ch2CategoryBars}
      {ch4Progress}
    </>
  );
}

// ── The right-page answer view (shown when an ask is active) ──
interface TraceEntry {
  query: string;
  rowCount: number;
  error?: string;
}

// The keeper's notes: the SQL the agent actually ran for this answer, as a collapsible strip
// of marginalia. Errors are tinted rust; successful queries show their row count. This is the
// audit trail (additive), shown only when the answer carries a trace.
function TracePanel({ trace }: { trace: TraceEntry[] }) {
  if (!trace || trace.length === 0) return null;
  return (
    <details style={{ marginTop: 14 }}>
      <summary style={{ fontFamily: WF.data, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: WF.inkSoft, cursor: "pointer" }}>
        The keeper&apos;s notes ({trace.length} {trace.length === 1 ? "query" : "queries"})
      </summary>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {trace.map((entry, index) => (
          <div key={index} style={{ borderLeft: `2px solid ${entry.error ? WF.rust : WF.sepiaSoft}`, paddingLeft: 8 }}>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: WF.inkSoft, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{entry.query}</div>
            <div style={{ fontFamily: WF.data, fontSize: 10, color: entry.error ? WF.rust : WF.sage }}>{entry.error ? `error: ${entry.error}` : `${entry.rowCount} row${entry.rowCount === 1 ? "" : "s"}`}</div>
          </div>
        ))}
      </div>
    </details>
  );
}

function AnswerView({ result, asking }: { result: QueryResult | null; asking: boolean }) {
  // "the keeper is reading the ledger" — request in flight, no answer yet.
  if (asking && !result) {
    return (
      <div style={{ position: "absolute", left: 660, right: 36, top: 170 }}>
        <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 18, color: WF.sepia }}>The keeper turns the pages, reading the ledger…</div>
      </div>
    );
  }
  if (!result) return null;
  const { chart, tableRows, answerText } = result;
  return (
    <div style={{ position: "absolute", left: 660, right: 36, top: 150 }}>
      <div style={{ fontFamily: WF.data, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 4 }}>The keeper answers</div>
      <div style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 22, color: WF.ink, lineHeight: 1.05, marginBottom: 12 }}>{chart.title || "An answer from the ledger"}</div>
      {/* Pick the chart component by kind; "none" shows just the plain answer text. */}
      {chart.kind === "bar" && <BarChart series={chart.series} width={432} height={150} />}
      {chart.kind === "line" && <TrendChart series={chart.series} width={432} height={150} />}
      {chart.kind === "donut" && <DonutChart series={chart.series} size={130} />}
      {chart.kind === "none" && <div style={{ fontFamily: WF.body, fontSize: 16, lineHeight: 1.5, color: WF.ink }}>{answerText}</div>}
      {tableRows && tableRows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <DataTable rows={tableRows} maxHeight={200} />
        </div>
      )}
      <TracePanel trace={(result as QueryResult & { trace?: TraceEntry[] }).trace ?? []} />
    </div>
  );
}

// ── The chapter-4 encounter (one real violation) + review controls ──
function EncounterView({ ch, activeTarget, view }: { ch: number; activeTarget: string | null; view: LedgerView }) {
  const { queue, mode } = view;
  const reviewing = mode === "ledger"; // live review only in Ledger mode

  // No flags at all in this ledger.
  if (queue.items.length === 0) {
    return (
      <div style={{ position: "absolute", left: 670, right: 40, top: 200 }}>
        <div style={{ fontFamily: WF.serif, fontStyle: "italic", fontSize: 20, color: WF.sage }}>No flags in this ledger. The pages are clean.</div>
      </div>
    );
  }

  // Reviewing in Ledger mode and reached the end -> decision summary.
  if (reviewing && queue.done) {
    const { approved, dismissed, escalated } = queue.counts;
    return (
      <div style={{ position: "absolute", left: 670, right: 40, top: 190 }}>
        <div style={{ fontFamily: WF.data, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: WF.inkSoft, marginBottom: 8 }}>The reckoning is done</div>
        <div style={{ display: "flex", gap: 22 }}>
          <Stat value={fmtInt(approved)} label="Approved" accent={WF.pine} />
          <Stat value={fmtInt(dismissed)} label="Dismissed" />
          <Stat value={fmtInt(escalated)} label="Escalated" accent={WF.rust} />
        </div>
      </div>
    );
  }

  // The encounter shown: queue.current in Ledger mode, else the headline (worst) flag.
  const violation: Violation | null = (reviewing ? queue.current : queue.items[0]) ?? null;
  if (!violation) return null;
  const index = reviewing ? queue.currentIndex : 0;
  const total = queue.items.length;

  // Vertically-centered flex column — card first, buttons immediately below.
  // Using plain divs (not POI) so nothing is position:absolute inside the flex container.
  // The POI glow is replicated manually via the activeTarget prop.
  return (
    <div style={{
      position: "absolute", left: 670, right: 40, top: 60, bottom: 60,
      display: "flex", flexDirection: "column", justifyContent: "center", gap: 16,
      pointerEvents: "auto",
    }}>
      {/* Violation card */}
      <div data-poi="violation" style={{ position: "relative" }}>
        {activeTarget === "violation" && (
          <div style={{ position: "absolute", inset: -11, borderRadius: 10, pointerEvents: "none", border: `2px dashed ${WF.gold}`, background: "rgba(231,178,76,0.10)", boxShadow: "0 0 0 4px rgba(231,178,76,0.10), 0 0 26px rgba(231,178,76,0.30)" }} />
        )}
        <div style={{ position: "relative", border: `1.5px solid ${WF.sepia}`, borderRadius: 6, background: WF.page, padding: 18 }}>
          <div style={{ position: "absolute", top: -11, right: 14 }}>
            <SevBadge level={severityToMood(violation.severity)} />
          </div>
          <div style={{ fontFamily: WF.data, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: WF.inkSoft, marginBottom: 5 }}>
            Encounter {index + 1} of {fmtInt(total)} · {violation.txn.id} · {humanRule(violation.ruleId)}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 21, color: WF.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{violation.txn.merchant}</span>
            <span style={{ fontFamily: WF.data, fontWeight: 600, fontSize: 22, color: WF.rust, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(violation.txn.amount)}</span>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }}>
            {violation.reasons.map((reason, reasonIndex) => (
              <Chip key={reasonIndex} tone={violation.severity === 2 ? "sev" : "warn"}
                style={{ whiteSpace: "normal", maxWidth: "100%", lineHeight: 1.4 }}>
                {reason}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* Approve / Dismiss / Escalate — sits directly below the card in flex flow */}
      <div data-poi="actions" style={{ pointerEvents: "auto" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <ActionBtn label="Approve" kbd="A" tone="pine" onClick={queue.approve} disabled={!reviewing || queue.done} style={{ flex: 1, pointerEvents: "auto" }} />
          <ActionBtn label="Dismiss" kbd="D" tone="plain" onClick={queue.dismiss} disabled={!reviewing || queue.done} style={{ flex: 1, pointerEvents: "auto" }} />
          <ActionBtn label="Escalate" kbd="E" tone="rust" onClick={queue.escalate} disabled={!reviewing || queue.done} style={{ flex: 1, pointerEvents: "auto" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 5, background: WF.page2, borderRadius: 3, overflow: "hidden", border: `0.5px solid ${WF.sepiaSoft}` }}>
            <div style={{ width: `${total > 0 ? (index / total) * 100 : 0}%`, height: "100%", background: WF.pumpkin, transition: "width .3s" }} />
          </div>
          <button type="button" onClick={queue.undo} disabled={!reviewing}
            style={{ fontFamily: WF.data, fontSize: 10, color: WF.inkSoft, border: `1px solid ${WF.sepiaSoft}`, borderRadius: 3, padding: "2px 7px", background: "transparent", cursor: reviewing ? "pointer" : "default", opacity: reviewing ? 1 : 0.5, pointerEvents: "auto" }}>
            ↩ undo · Z
          </button>
        </div>
        {!reviewing && (
          <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 12.5, color: WF.sepia, marginTop: 8 }}>Switch to the Ledger ribbon to review these flags yourself.</div>
        )}
      </div>
    </div>
  );
}

// A centered note for the right page: loading, empty, error, and between-mode states.
function CenteredNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: 660, right: 40, top: 200 }}>
      <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 18, color: WF.sepia, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

// The pre-approval encounter (Feature 3): one charge with its budget status, card history,
// and the AI recommendation + reasoning, plus approve/deny controls (A/D, undo Z). Mirrors
// the violations queue. Live review only in Ledger mode; Story mode shows a gentle prompt.
function ApprovalView({ view }: { view: LedgerView }) {
  const { approvals, mode } = view;
  const reviewing = mode === "ledger";

  if (approvals.loading) return <CenteredNote>The keeper gathers the charges that await your seal…</CenteredNote>;
  if (approvals.error) return <CenteredNote>{approvals.error}</CenteredNote>;
  if (!reviewing) return <CenteredNote>Switch to the Ledger ribbon, and I will bring you the charges that await approval.</CenteredNote>;
  if (approvals.items.length === 0) return <CenteredNote>No charge awaits approval. The gate is quiet.</CenteredNote>;

  // Reached the end: a small decision summary.
  if (approvals.done) {
    const { approved, denied } = approvals.counts;
    return (
      <div style={{ position: "absolute", left: 670, right: 40, top: 190 }}>
        <div style={{ fontFamily: WF.data, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: WF.inkSoft, marginBottom: 8 }}>Every charge has been judged</div>
        <div style={{ display: "flex", gap: 22 }}>
          <Stat value={fmtInt(approved)} label="Approved" accent={WF.pine} />
          <Stat value={fmtInt(denied)} label="Denied" accent={WF.rust} />
        </div>
      </div>
    );
  }

  const item = approvals.current;
  if (!item) return null;
  const index = approvals.currentIndex;
  const total = approvals.items.length;
  const budget = item.categoryBudget;
  const recommendDeny = item.recommendation === "deny";

  return (
    <>
      <div style={{ position: "absolute", left: 670, top: 162, width: 448, pointerEvents: "auto" }}>
        <div style={{ position: "relative", border: `1.5px solid ${WF.sepia}`, borderRadius: 6, background: WF.page, padding: 18 }}>
          <div style={{ position: "absolute", top: -11, right: 14 }}>
            <SevBadge level={severityToMood(item.severity)} />
          </div>
          <div style={{ fontFamily: WF.data, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: WF.inkSoft, marginBottom: 5 }}>
            Charge {index + 1} of {fmtInt(total)} · {item.txn.category}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 21, color: WF.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.txn.merchant}</span>
            <span style={{ fontFamily: WF.data, fontWeight: 600, fontSize: 22, color: WF.rust, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(item.txn.amount)}</span>
          </div>
          {/* Employee + department badge */}
          {(item.txn.employeeId || item.txn.department) && (
            <div style={{ display: "flex", gap: 7, marginTop: 8, flexWrap: "wrap" }}>
              {item.txn.employeeId && (
                <Chip tone="plain">{item.txn.employeeId}</Chip>
              )}
              {item.txn.department && (
                <Chip tone="plain">{item.txn.department}</Chip>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginTop: 10, fontFamily: WF.data, fontSize: 11.5, color: WF.ink }}>
            <span>Limit <b>{money(budget.limit)}</b></span>
            <span>Spent <b>{money(budget.spent)}</b></span>
            <span>Left <b style={{ color: budget.remaining < item.txn.amount ? WF.rust : WF.pine }}>{money(budget.remaining)}</b></span>
          </div>
          <div style={{ fontFamily: WF.data, fontSize: 10.5, color: WF.inkSoft, marginTop: 8, lineHeight: 1.4 }}>{item.employeeSummary}</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
            <Chip tone={recommendDeny ? "sev" : "plain"}>Keeper counsels: {recommendDeny ? "deny" : "approve"}</Chip>
          </div>
          <div style={{ fontFamily: WF.body, fontSize: 13, color: WF.ink, lineHeight: 1.45, marginTop: 10 }}>{item.reasoning}</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 670, top: 500, width: 448, pointerEvents: "auto" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <ActionBtn label="Approve" kbd="A" tone="pine" onClick={approvals.approve} disabled={approvals.done} style={{ flex: 1 }} />
          <ActionBtn label="Deny" kbd="D" tone="rust" onClick={approvals.deny} disabled={approvals.done} style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 5, background: WF.page2, borderRadius: 3, overflow: "hidden", border: `0.5px solid ${WF.sepiaSoft}` }}>
            <div style={{ width: `${total > 0 ? (index / total) * 100 : 0}%`, height: "100%", background: WF.pumpkin, transition: "width .3s" }} />
          </div>
          <button type="button" onClick={approvals.undo} style={{ fontFamily: WF.data, fontSize: 10, color: WF.inkSoft, border: `1px solid ${WF.sepiaSoft}`, borderRadius: 3, padding: "2px 7px", background: "transparent", cursor: "pointer", pointerEvents: "auto" }}>
            ↩ undo · Z
          </button>
        </div>
      </div>
    </>
  );
}

// The trips view (Feature 4): the list of route reports; open one to see its grouped charges
// and its policy flags. Opened-report state is local to this component.
function TripsView({ view }: { view: LedgerView }) {
  const { reports } = view;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (reports.loading) return <CenteredNote>The keeper traces the roads you traveled…</CenteredNote>;
  if (reports.error) return <CenteredNote>{reports.error}</CenteredNote>;
  if (reports.reports.length === 0) return <CenteredNote>No trips found in this ledger.</CenteredNote>;

  const opened = openIndex !== null ? reports.reports[openIndex] : null;

  // A single opened trip: its grouped charges and any policy flags.
  if (opened) {
    const txnRows = opened.transactions.slice(0, 60).map((transaction) => ({
      Date: transaction.txnDate ?? "n/a",
      Merchant: transaction.merchant,
      Category: transaction.category,
      Amount: Math.round(transaction.amount),
    }));
    return (
      <div style={{ position: "absolute", left: 660, right: 36, top: 150 }}>
        <button type="button" onClick={() => setOpenIndex(null)} style={{ fontFamily: WF.data, fontSize: 10.5, color: WF.inkSoft, border: `1px solid ${WF.sepiaSoft}`, borderRadius: 3, padding: "2px 8px", background: "transparent", cursor: "pointer", marginBottom: 8 }}>
          ◀ all trips
        </button>
        <div style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 20, color: WF.ink, lineHeight: 1.05 }}>{opened.label}</div>
        <div style={{ fontFamily: WF.data, fontSize: 11, color: WF.inkSoft, marginTop: 4 }}>
          {opened.region} · {opened.startDate} to {opened.endDate} · {money(opened.total)}
        </div>
        {opened.violations.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {opened.violations.slice(0, 6).map((violation, violationIndex) => (
              <Chip key={violationIndex} tone={violation.severity === 2 ? "sev" : "warn"}>
                ⚑ {humanRule(violation.ruleId)} · {money(violation.txn.amount)}
              </Chip>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <DataTable rows={txnRows} maxHeight={300} />
        </div>
      </div>
    );
  }

  // The list of trips.
  return (
    <div style={{ position: "absolute", left: 660, right: 36, top: 150, pointerEvents: "auto" }}>
      <RightHead>Trips on the road</RightHead>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 430, overflowY: "auto" }}>
        {reports.reports.map((report, reportIndex) => (
          <button
            key={report.id}
            type="button"
            onClick={() => setOpenIndex(reportIndex)}
            style={{ textAlign: "left", border: `1px solid ${WF.sepiaSoft}`, borderRadius: 5, background: WF.page, padding: "9px 12px", cursor: "pointer" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 15, color: WF.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{report.label}</span>
              <span style={{ fontFamily: WF.data, fontWeight: 600, fontSize: 14, color: WF.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(report.total)}</span>
            </div>
            <div style={{ fontFamily: WF.data, fontSize: 10.5, color: WF.inkSoft, marginTop: 3 }}>
              {report.transactions.length} charges{report.violations.length > 0 ? ` · ${report.violations.length} flag${report.violations.length === 1 ? "" : "s"}` : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Categories that accept dollar limits in the policy form (excludes alcohol, gift_card, other).
const POLICY_CATEGORIES: Category[] = [
  "fuel", "permits_gov", "vehicle_maintenance", "supplies", "tolls", "telecom", "digital",
  "transport", "parking", "car_rental", "lodging", "airfare", "meal", "marketplace",
];

const CAT_LABELS: Record<string, string> = {
  fuel: "Fuel", permits_gov: "Permits & Gov", vehicle_maintenance: "Vehicle Maint.",
  supplies: "Supplies", tolls: "Tolls", telecom: "Telecom", digital: "Digital / SaaS",
  transport: "Transport", parking: "Parking", car_rental: "Car Rental",
  lodging: "Lodging", airfare: "Airfare", meal: "Meals", marketplace: "Marketplace",
};

interface FormDraft {
  preauthThreshold: string;
  splitThreshold: string;
  enableAlcohol: boolean;
  enableDuplicate: boolean;
  enableAnomaly: boolean;
  flagForeignTransactions: boolean;
  enableMealContext: boolean;
  limits: Record<string, string>;
}

function rulesToDraft(r: RuleSet): FormDraft {
  return {
    preauthThreshold: r.preauthThreshold > 0 ? String(r.preauthThreshold) : "",
    splitThreshold: r.splitThreshold > 0 ? String(r.splitThreshold) : "",
    enableAlcohol: r.enableAlcohol,
    enableDuplicate: r.enableDuplicate,
    enableAnomaly: r.enableAnomaly,
    flagForeignTransactions: r.flagForeignTransactions,
    enableMealContext: r.enableMealContext,
    limits: Object.fromEntries(
      POLICY_CATEGORIES.map((cat) => [cat, r.categoryLimits[cat] ? String(r.categoryLimits[cat]) : ""])
    ),
  };
}

function draftToRulePatch(d: FormDraft): Partial<RuleSet> {
  return {
    preauthThreshold: Number(d.preauthThreshold) || 0,
    splitThreshold: Number(d.splitThreshold) || 0,
    enableAlcohol: d.enableAlcohol,
    enableDuplicate: d.enableDuplicate,
    enableAnomaly: d.enableAnomaly,
    flagForeignTransactions: d.flagForeignTransactions,
    enableMealContext: d.enableMealContext,
    categoryLimits: Object.fromEntries(
      POLICY_CATEGORIES.map((cat) => [cat, Number(d.limits[cat]) || 0])
    ),
  };
}

// Parchment-style number input.
function ParchmentInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "0"}
      style={{
        width: "100%", fontFamily: WF.data, fontSize: 11.5, color: WF.ink,
        background: WF.page2, border: `1px solid ${WF.sepiaSoft}`, borderRadius: 4,
        padding: "4px 8px", outline: "none", boxSizing: "border-box",
        pointerEvents: "auto",
      }}
    />
  );
}

// Toggle pill in the book palette.
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: on ? WF.pine : "rgba(138,111,78,0.10)",
        border: `1px solid ${on ? WF.pine : WF.sepiaSoft}`,
        borderRadius: 11, padding: "4px 11px", cursor: "pointer",
        color: on ? "#EFE2C9" : WF.inkSoft, fontFamily: WF.data, fontSize: 11,
        transition: "all .15s", pointerEvents: "auto",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: on ? "#EFE2C9" : WF.sepiaSoft, flexShrink: 0 }} />
      {label}
    </button>
  );
}

function FormSectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontFamily: WF.data, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 6, marginTop: 14 }}>
      {children}
    </div>
  );
}

// Left page of ch7: chapter header + KPIs are rendered by renderLeft; this adds the form below.
function PolicyLeftPage({ view }: { view: LedgerView }) {
  const { policy } = view;
  const [draft, setDraft] = useState<FormDraft>(() => rulesToDraft(policy.rules));
  const prevLoadingRef = useRef(policy.loading);

  // Sync the form whenever loading transitions from true→false so the form always
  // reflects what the server actually has (not the client-side DEFAULT_RULES placeholder).
  useEffect(() => {
    if (prevLoadingRef.current && !policy.loading) {
      setDraft(rulesToDraft(policy.rules));
    }
    prevLoadingRef.current = policy.loading;
  }, [policy.loading, policy.rules]);

  const toggleFlag = (key: "enableAlcohol" | "enableDuplicate" | "enableAnomaly" | "flagForeignTransactions" | "enableMealContext") =>
    setDraft((p) => ({ ...p, [key]: !p[key] }));

  const handleSubmit = () => {
    if (policy.saving) return;
    void policy.updateRules(draftToRulePatch(draft));
  };

  return (
    // Width is deliberately capped to the left half (left:70 + width:480 = 550px < 600px gutter).
    <div style={{ position: "absolute", left: 70, top: 218, width: 480, bottom: 18, overflowY: "auto", pointerEvents: "auto" }}>

      <FormSectionLabel>Pre-Authorization &amp; Split Detection</FormSectionLabel>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: WF.data, fontSize: 9.5, color: WF.inkSoft, marginBottom: 3 }}>Pre-Auth Limit $ (0 = off)</div>
          <ParchmentInput value={draft.preauthThreshold} onChange={(v) => setDraft((p) => ({ ...p, preauthThreshold: v }))} placeholder="e.g. 50" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: WF.data, fontSize: 9.5, color: WF.inkSoft, marginBottom: 3 }}>Split Threshold $ (0 = off)</div>
          <ParchmentInput value={draft.splitThreshold} onChange={(v) => setDraft((p) => ({ ...p, splitThreshold: v }))} placeholder="e.g. 50" />
        </div>
      </div>

      <FormSectionLabel>Detection Flags</FormSectionLabel>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Toggle label="Duplicates" on={draft.enableDuplicate} onClick={() => toggleFlag("enableDuplicate")} />
        <Toggle label="Anomalies" on={draft.enableAnomaly} onClick={() => toggleFlag("enableAnomaly")} />
        <Toggle label="Foreign" on={draft.flagForeignTransactions} onClick={() => toggleFlag("flagForeignTransactions")} />
      </div>

      <FormSectionLabel>Category Spending Limits ($)</FormSectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 14px" }}>
        {POLICY_CATEGORIES.map((cat) => {
          const isSet = !!(draft.limits[cat] && Number(draft.limits[cat]) > 0);
          return (
          <div key={cat} style={{ display: "flex", alignItems: "center", gap: 7, opacity: isSet ? 1 : 0.55, transition: "opacity .15s" }}>
            <div style={{ fontFamily: WF.data, fontSize: 10, color: isSet ? WF.ink : WF.inkSoft, width: 90, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: isSet ? 600 : 400 }}>
              {CAT_LABELS[cat] ?? cat}
            </div>
            <ParchmentInput
              value={draft.limits[cat] ?? ""}
              onChange={(v) => setDraft((p) => ({ ...p, limits: { ...p.limits, [cat]: v } }))}
              placeholder="no limit"
            />
          </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={policy.saving}
          style={{
            width: "100%", fontFamily: WF.data, fontSize: 12.5, fontWeight: 600,
            color: "#fff", background: policy.saving ? WF.sepia : WF.pumpkin,
            border: `1.5px solid ${policy.saving ? WF.sepia : WF.pumpkin}`,
            borderRadius: 5, padding: "9px 0", cursor: policy.saving ? "default" : "pointer",
            transition: "background .15s", pointerEvents: "auto",
          }}
        >
          {policy.saving ? "The keeper is casting the net…" : "Seal the Ordinance ↵"}
        </button>
        {policy.error && (
          <div style={{ fontFamily: WF.data, fontSize: 10.5, color: WF.rust, marginTop: 6 }}>{policy.error}</div>
        )}
      </div>
    </div>
  );
}

// Badge for a violation in the policy panel.
function PolicyViolationBadge({ ruleId, severity }: { ruleId: string; severity: number }) {
  if (ruleId === "PENDING_CONTEXT") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", padding: "3px 9px",
        borderRadius: 10, border: "1px solid rgba(100,70,160,0.45)",
        background: "rgba(100,70,160,0.10)", color: "rgba(100,70,160,0.85)",
        fontFamily: WF.data, fontSize: 10, whiteSpace: "nowrap",
      }}>pending</span>
    );
  }
  if (ruleId === "NON_REIMBURSABLE") return <Chip tone="sev" style={{ fontSize: 10, padding: "2px 8px" }}>not reimbursable</Chip>;
  if (severity >= 2) return <Chip tone="sev" style={{ fontSize: 10, padding: "2px 8px" }}>alert</Chip>;
  if (severity >= 1) return <Chip tone="warn" style={{ fontSize: 10, padding: "2px 8px" }}>warning</Chip>;
  return <Chip tone="plain" style={{ fontSize: 10, padding: "2px 8px" }}>info</Chip>;
}

// Right page of ch7: violations found under the current rules.
function PolicyRightPage({ view }: { view: LedgerView }) {
  const { policy } = view;

  if (policy.loading) {
    return (
      <div style={{ position: "absolute", left: 660, right: 36, top: 200, pointerEvents: "none" }}>
        <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 18, color: WF.sepia }}>
          The keeper casts the net across the ledger…
        </div>
      </div>
    );
  }

  const displayed = policyDisplayed(policy.violations, policy.rules);
  const hasLimits = Object.keys(policy.rules.categoryLimits).length > 0;
  const preauthCount = policy.violations.filter((v) => v.ruleId === "OVER_PREAUTH").length;
  const preauthThreshold = policy.rules.preauthThreshold;
  // top: 162 leaves room for the Keeper bar, which is pinned at top: 38 on ch7.
  const PANEL_TOP = 162;

  // Pre-auth receipt tally — always shown as a dim note, never counted as a flag.
  const PreauthNote = preauthCount > 0 && preauthThreshold > 0 ? (
    <div style={{ fontFamily: WF.data, fontSize: 10, color: WF.inkSoft, marginBottom: 10, padding: "5px 10px", background: "rgba(138,111,78,0.06)", border: `1px solid ${WF.sepiaSoft}`, borderRadius: 4, flexShrink: 0 }}>
      {fmtInt(preauthCount)} charges exceed the ${preauthThreshold} pre-auth threshold — receipts required, not counted as flags
    </div>
  ) : null;

  if (displayed.length === 0) {
    return (
      <div style={{ position: "absolute", left: 660, right: 36, top: PANEL_TOP, bottom: 18, pointerEvents: "none" }}>
        {PreauthNote}
        <div style={{ fontFamily: WF.data, fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 10 }}>
          Flagged under the Ordinance
        </div>
        <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 17, color: WF.sage, lineHeight: 1.55 }}>
          {hasLimits
            ? "No charges exceed these limits. The ordinance is satisfied."
            : "Set a rule above and seal the ordinance to see what breaks it."}
        </div>
      </div>
    );
  }

  const shown = displayed.slice(0, 200);

  return (
    <div style={{ position: "absolute", left: 660, right: 36, top: PANEL_TOP, bottom: 18, display: "flex", flexDirection: "column", pointerEvents: "auto" }}>
      {PreauthNote}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexShrink: 0 }}>
        <div style={{ fontFamily: WF.data, fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: WF.pumpkin }}>
          Flagged under the Ordinance
        </div>
        <div style={{ fontFamily: WF.data, fontSize: 11, color: WF.inkSoft }}>
          {fmtInt(displayed.length)} {displayed.length === 1 ? "charge" : "charges"}
        </div>
      </div>
      {/* minHeight:0 is required so the flex child can shrink below content size and actually scroll */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", flex: "1 1 0", minHeight: 0 }}>
        {shown.map((v) => {
          // severity comes from the engine, not a UI dollar cutoff
          const borderColor = v.ruleId === "PENDING_CONTEXT"
            ? "rgba(100,70,160,0.3)"
            : v.severity >= 2 ? "rgba(158,59,46,0.4)" : v.severity >= 1 ? "rgba(200,146,58,0.4)" : WF.sepiaSoft;
          return (
            <div key={v.txn.id} style={{ border: `1px solid ${borderColor}`, borderRadius: 4, background: WF.page, padding: "6px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 13, color: WF.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {v.txn.merchant}
                </span>
                <span style={{ fontFamily: WF.data, fontWeight: 600, fontSize: 13, color: WF.rust, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {money(v.txn.amount)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                <PolicyViolationBadge ruleId={v.ruleId} severity={v.severity} />
                {v.txn.category && (
                  <span style={{ fontFamily: WF.data, fontSize: 9, color: WF.inkSoft, background: "rgba(138,111,78,0.10)", border: `1px solid ${WF.sepiaSoft}`, borderRadius: 8, padding: "1px 7px", whiteSpace: "nowrap" }}>
                    {v.txn.category.replace(/_/g, " ")}
                  </span>
                )}
                {v.txn.txnDate && (
                  <span style={{ fontFamily: WF.data, fontSize: 9, color: WF.inkSoft, whiteSpace: "nowrap" }}>
                    {v.txn.txnDate}
                  </span>
                )}
                {v.reasons[0] && (
                  <span style={{ fontFamily: WF.data, fontSize: 9, color: WF.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                    {v.reasons[0]}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {displayed.length > 200 && (
          <div style={{ fontFamily: WF.data, fontSize: 10, color: WF.inkSoft, textAlign: "center", padding: "5px 0" }}>
            …and {fmtInt(displayed.length - 200)} more
          </div>
        )}
      </div>
    </div>
  );
}

// ── RIGHT page per chapter ──
export function renderRight(ch: number, activeTarget: string | null, view: LedgerView): ReactNode {
  // An active ask answer (or in-flight ask) takes over the right page in any chapter.
  if (view.asking || view.answer) {
    return <AnswerView result={view.answer} asking={view.asking} />;
  }

  const { data } = view;

  if (ch === 0) {
    return (
      <div style={{ position: "absolute", left: 600, right: 0, top: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", marginBottom: 26 }}>
          <div style={{ position: "absolute", inset: -46, background: `radial-gradient(circle, ${WF.gold}33, transparent 68%)` }} />
          <svg width="54" height="70" viewBox="0 0 60 78" style={{ position: "relative" }}>
            <line x1="30" y1="2" x2="30" y2="18" stroke={WF.gold} strokeWidth="2" />
            <rect x="14" y="18" width="32" height="40" rx="3" fill={WF.gold} opacity="0.85" stroke="#7a5a20" strokeWidth="2" />
            <rect x="14" y="12" width="32" height="8" rx="2" fill={WF.sepia} stroke="#7a5a20" strokeWidth="2" />
          </svg>
        </div>
        <div style={{ fontFamily: WF.serif, fontStyle: "italic", fontSize: 28, color: WF.sepia, marginBottom: 28, lineHeight: 1.25, textAlign: "center", maxWidth: 320 }}>What do the books hide this month?</div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, background: WF.pumpkin, color: "#fff", padding: "13px 26px", borderRadius: 4, fontFamily: WF.data, fontSize: 14, fontWeight: 600, boxShadow: "0 8px 20px rgba(0,0,0,0.25)" }}>Open the ledger →</div>
      </div>
    );
  }

  if (ch === 1) {
    const RULE_SHORT: Record<string, string> = {
      ANOMALY: "anomaly", DUPLICATE: "duplicate", SPLIT: "split",
      GIFT_CARD: "gift card", ALCOHOL: "alcohol", FOREIGN_TXN: "foreign",
      CATEGORY_LIMIT: "over limit", PENDING_CONTEXT: "pending", NON_REIMBURSABLE: "policy",
    };
    // Top notable items — violations is already the suspicious set (OVER_PREAUTH excluded).
    const notable = data.violations.slice(0, 7);
    return (
      <>
        <POI id="trend" active={activeTarget === "trend"} style={{ left: 678, top: 148, width: 432 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <RightHead>Spend over time</RightHead>
            <span style={{ fontFamily: WF.data, fontSize: 10, color: WF.inkSoft }}>by month</span>
          </div>
          <LabeledTrendChart series={data.trend} width={432} height={200} />
        </POI>
        <POI id="finding" active={activeTarget === "finding"} style={{ left: 678, top: 380, width: 432 }}>
          <RightHead>Passages worth marking</RightHead>
          {notable.length === 0 && (
            <div style={{ fontFamily: WF.body, fontStyle: "italic", fontSize: 13, color: WF.sage }}>No suspicious charges found.</div>
          )}
          {notable.map((v) => (
            <div key={v.txn.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <Chip tone={v.severity >= 2 ? "sev" : "warn"} style={{ flexShrink: 0, fontSize: 10, padding: "2px 8px" }}>
                {RULE_SHORT[v.ruleId] ?? "flag"}
              </Chip>
              <span style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 12.5, color: WF.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {v.txn.merchant}
              </span>
              <span style={{ fontFamily: WF.data, fontWeight: 600, fontSize: 12.5, color: WF.rust, whiteSpace: "nowrap", flexShrink: 0 }}>
                {money(v.txn.amount)}
              </span>
            </div>
          ))}
          {data.flagCount > notable.length && (
            <div style={{ fontFamily: WF.data, fontSize: 10, color: WF.inkSoft, marginTop: 4 }}>
              …and {fmtInt(data.flagCount - notable.length)} more — see Violations chapter
            </div>
          )}
        </POI>
      </>
    );
  }

  if (ch === 2) {
    const catSum = data.categoryShare.reduce((s, p) => s + p.value, 0);
    // Top 10 categories for the legend; beyond that the names crowd together.
    const legendItems = data.categoryShare.slice(0, 10);
    return (
      <>
        {/* Full right-page width so the legend never reaches the Keeper (x≈1014) */}
        <POI id="donut" active={activeTarget === "donut"} style={{ left: 670, top: 138, width: 462 }}>
          <RightHead>By category</RightHead>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
            {/* Ring without built-in legend — keeps it compact */}
            <DonutChart series={data.categoryShare} size={160} showLegend={false} style={{ flexShrink: 0 }} />
            {/* Compact 2-column legend to the right of the ring */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 14px", fontFamily: WF.data, fontSize: 10.5, color: WF.ink, alignContent: "start", paddingTop: 4 }}>
              {legendItems.map((p, i) => {
                const pct = catSum > 0 ? Math.round((p.value / catSum) * 100) : 0;
                return (
                  <span key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <b style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>●</b>{" "}
                    {p.label} · {pct}%
                  </span>
                );
              })}
              {data.categoryShare.length > 10 && (
                <span style={{ color: WF.inkSoft, fontStyle: "italic" }}>+ {data.categoryShare.length - 10} more</span>
              )}
            </div>
          </div>
        </POI>
        {/* Bar chart sits clearly below the donut block (ring=160px + head≈20px + padding) */}
        <POI id="bars" active={activeTarget === "bars"} style={{ left: 678, top: 400, width: 432 }}>
          <RightHead>Month over month</RightHead>
          <BarChart series={data.trend} width={432} height={136} showLabels />
        </POI>
      </>
    );
  }

  if (ch === 3) {
    const top = data.categoryShare[0];
    const sum = data.categoryShare.reduce((total, point) => total + point.value, 0);
    const pct = top && sum > 0 ? Math.round((top.value / sum) * 100) : 0;
    // Top vendors as table rows (columns derived by DataTable from these keys).
    const vendorRows = data.topVendors.map((vendor) => ({ Vendor: vendor.label, Spend: Math.round(vendor.value) }));
    return (
      <>
        <POI id="merchants" active={activeTarget === "merchants"} style={{ left: 678, top: 145, width: 432 }}>
          <RightHead>Top vendors by spend</RightHead>
          <DataTable rows={vendorRows} maxHeight={210} />
        </POI>
        <POI id="consolidation" active={activeTarget === "consolidation"} style={{ left: 678, top: 432, width: 432 }}>
          <div style={{ border: `1.5px solid ${WF.pine}`, borderRadius: 6, background: "rgba(51,80,63,0.08)", padding: "13px 15px" }}>
            <div style={{ fontFamily: WF.data, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: WF.pine, marginBottom: 5 }}>Consolidation</div>
            <div style={{ fontFamily: WF.body, fontSize: 14.5, color: WF.ink, lineHeight: 1.45 }}>
              {top ? (
                <>
                  Your largest category, <b>{top.label}</b>, is <b>{pct}%</b> of all spend ({money(top.value)}). Routing it through fewer preferred vendors is the clearest place to save.
                </>
              ) : (
                <>Spending spreads across many vendors. Routing it through fewer preferred vendors is the clearest place to save.</>
              )}
            </div>
          </div>
        </POI>
      </>
    );
  }

  // ch 4 — the violations encounter + review queue
  if (ch === 4) return <EncounterView ch={ch} activeTarget={activeTarget} view={view} />;
  if (ch === 5) return <ApprovalView view={view} />;
  if (ch === 6) return <TripsView view={view} />;
  if (ch === 7) return <PolicyRightPage view={view} />;
  return null;
}

// ── beats: keeper choreography (positions are static; lines are data-derived below) ──
export interface Beat {
  ch: number;
  x: number;
  y: number;
  face: "left" | "right";
  target: string | null;
  mood: "neutral" | "concerned" | "alarmed";
  pose: "idle" | "pointing";
  line: string; // generic fallback, used until live data loads
}

export const BEATS: Beat[] = [
  { ch: 0, x: 600, y: 560, face: "right", target: null, mood: "neutral", pose: "idle", line: "Welcome to the ledger. Shall we turn the first page?" },

  { ch: 1, x: 556, y: 168, face: "left", target: "kpis", mood: "neutral", pose: "pointing", line: "Here is the tale of these months, told in totals — and a handful of charges I have marked." },
  { ch: 1, x: 612, y: 250, face: "right", target: "trend", mood: "neutral", pose: "pointing", line: "Spending holds its shape, month to month — fuel and permits, the honest upkeep of a fleet." },
  { ch: 1, x: 612, y: 470, face: "right", target: "finding", mood: "concerned", pose: "pointing", line: "But a few passages trouble me. One of them, gravely." },

  { ch: 2, x: 1014, y: 258, face: "left", target: "donut", mood: "neutral", pose: "pointing", line: "Where does it all go? Let us see which slice burns the largest." },
  { ch: 2, x: 612, y: 470, face: "right", target: "bars", mood: "concerned", pose: "pointing", line: "And it rises and falls with the seasons of the road." },

  { ch: 3, x: 612, y: 280, face: "right", target: "merchants", mood: "neutral", pose: "pointing", line: "Your spending gathers at a few doors. It need not scatter so." },
  { ch: 3, x: 612, y: 492, face: "right", target: "consolidation", mood: "concerned", pose: "pointing", line: "Bring the vendors together, and there is coin to be saved each year." },

  { ch: 4, x: 604, y: 300, face: "right", target: "violation", mood: "alarmed", pose: "pointing", line: "And here it is — the charge that troubles me most of all." },
  { ch: 4, x: 604, y: 500, face: "right", target: "actions", mood: "alarmed", pose: "pointing", line: "Approve, dismiss, or escalate. I would not let this one pass quietly." },

  { ch: 5, x: 556, y: 168, face: "left", target: "kpis", mood: "neutral", pose: "pointing", line: "Some charges wait at the gate for a seal. Shall we weigh them together?" },
  { ch: 5, x: 604, y: 320, face: "right", target: null, mood: "concerned", pose: "idle", line: "I will tell you what the budget allows and what this card has done before. The choice is yours: approve or deny." },

  { ch: 6, x: 556, y: 168, face: "left", target: "kpis", mood: "neutral", pose: "pointing", line: "Every journey leaves its mark in the ledger. Here are the roads you traveled." },
  { ch: 6, x: 604, y: 320, face: "right", target: null, mood: "concerned", pose: "idle", line: "Open a trip, and I will show you its charges and any shadow that follows it." },

  { ch: 7, x: 556, y: 168, face: "left", target: "kpis", mood: "neutral", pose: "pointing", line: "Here is where the rules are written. Every edict you set, I will enforce without hesitation." },
  { ch: 7, x: 604, y: 360, face: "right", target: null, mood: "concerned", pose: "idle", line: "Seal the ordinance, and I will return with every charge that breaks it. The ledger does not forgive." },
];

export const CHAPTERS = [
  { id: "cover", label: "Cover" },
  { id: "tale", label: "The Tale" },
  { id: "category", label: "Category" },
  { id: "vendors", label: "Vendors" },
  { id: "violations", label: "Violations" },
  { id: "approvals", label: "Pre-Approval" },
  { id: "trips", label: "Trips" },
  { id: "policy", label: "Policy" },
];

/**
 * The spoken line for a beat, woven from live data where it matters (so the keeper speaks
 * the real $1.5M, the real top category, the real worst flag). Falls back to the beat's
 * generic line until the data loads, so the tour is never silent or wrong.
 */
export function beatLine(beatIndex: number, view: LedgerView): string {
  const beat = BEATS[beatIndex];
  if (!beat) return "";
  const { data } = view;
  const topFlag = data.violations[0];
  const topCat = data.categoryShare[0];
  const topVendor = data.topVendors[0];
  const catSum = data.categoryShare.reduce((total, point) => total + point.value, 0);
  const catPct = topCat && catSum > 0 ? Math.round((topCat.value / catSum) * 100) : 0;

  switch (beatIndex) {
    case 1:
      return data.totalSpend !== null
        ? `In six months, ${money(data.totalSpend)} across ${fmtInt(data.transactionCount)} charges — ${fmtInt(data.flagCount)} drew my eye as worth a second look.`
        : beat.line;
    case 3:
      return topFlag ? `But a few passages trouble me. The gravest: ${topFlag.txn.merchant} at ${money(topFlag.txn.amount)}.` : beat.line;
    case 4:
      return topCat ? `Where does it all go? ${topCat.label} alone is ${catPct} parts in a hundred of every dollar.` : beat.line;
    case 6:
      return topVendor ? `Your spending gathers most at one door — ${topVendor.label}, ${money(topVendor.value)} in all.` : beat.line;
    case 8:
      return topFlag ? `And here it is — ${money(topFlag.txn.amount)} at ${topFlag.txn.merchant}. ${humanRule(topFlag.ruleId)}.` : beat.line;
    case 14: {
      const pv = view.policy.violations;
      return pv.length > 0
        ? `The ordinance has spoken — ${fmtInt(pv.length)} charges flagged under the rules as written.`
        : "Write the rules, seal the ordinance, and I will read every charge against them.";
    }
    default:
      return beat.line;
  }
}
