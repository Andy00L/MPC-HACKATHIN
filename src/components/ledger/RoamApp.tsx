/**
 * components/ledger/RoamApp.tsx
 * The orchestrator. Preserves the wireframe's chapter/beat/page-turn state machine
 * (bi, ch, pos, moving, flip, auto, scale; the self-rescheduling auto-tour; the go()
 * page-turn sequence) and replaces every scripted data source with the live hooks:
 *
 *   - useLedgerData  — overview + charts on mount (the book's numbers).
 *   - useVoice       — render-first narration playback + mute.
 *   - useReviewQueue — the real chapter-4 violations queue (A/D/E/Z, undo, progress).
 *   - client.askData — the real talk-to-data ask flow (AbortController-cancellable).
 *
 * Keeper mood is driven by the active severity via severityToMood; whenever the active
 * narration line changes, the text/chart render first and THEN the voice speaks it.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueryResult, Severity } from "@/lib/contract";
import { WF, SEV, type Mood } from "./tokens";
import { severityToMood } from "./severity";
import { Backdrop, Paper, Gutter, ModeRibbon } from "./primitives";
import { Keeper, DialogCaption } from "./Keeper";
import { BEATS, CHAPTERS, beatLine, renderLeft, renderRight, type Beat, type LedgerView } from "./chapters";
import { useLedgerData } from "@/hooks/useLedgerData";
import { useVoice } from "@/hooks/useVoice";
import { useReviewQueue } from "@/hooks/useReviewQueue";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";
import { useReports } from "@/hooks/useReports";
import { askData } from "@/lib/api/client";

const STAGE_W = 1200;
const STAGE_H = 760;

// Quick-prompt chips. They feed the SAME real askData flow as the typed input; the last
// one ("payroll") has no matching data, so the engine honestly answers "nothing matches".
const QUICK_ASKS = ["Where does the money go?", "Top vendors by spend", "Spend over time", "Anything over $1,000?", "Show me payroll"];

// Synthesized page-flutter sound, created on first gesture. Guarded for SSR and wrapped so
// audio can never break navigation.
let _audioCtx: AudioContext | null = null;
function pageSound(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    _audioCtx = _audioCtx ?? new Ctor();
    const ctx = _audioCtx;
    const dur = 0.2;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / channel.length, 2.2) * 0.6;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1100;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch {
    // audio is a nicety; never let it break the page turn
  }
}

export function RoamApp() {
  // ── tour/state machine (ported) ──
  const [bi, setBi] = useState(0); // beat index
  const [ch, setCh] = useState(0); // chapter
  const [pos, setPos] = useState<{ x: number; y: number; face: "left" | "right" }>({ x: 600, y: 560, face: "right" });
  const [moving, setMoving] = useState(false);
  const [flip, setFlip] = useState<"fwd" | "back" | null>(null);
  const [auto, setAuto] = useState(true);
  const [scale, setScale] = useState(1);

  // ── new interactive state ──
  const [mode, setMode] = useState<"story" | "ledger">("story");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askText, setAskText] = useState("");
  const [askSeq, setAskSeq] = useState(0);

  // ── live data ──
  const data = useLedgerData();
  const voice = useVoice();
  const queue = useReviewQueue(data.violations, mode === "ledger" && ch === 4);
  // Feature 3 + 4: lazily loaded. Approvals fetch only when reviewing that chapter (each item
  // is a model call); reports fetch whenever the Trips chapter is reached (cheap, deterministic).
  const approvals = useApprovalQueue(mode === "ledger" && ch === 5);
  const reports = useReports(ch === 6);

  // refs that always hold the latest value for the stable callbacks
  const chRef = useRef(0);
  chRef.current = ch;
  const posRef = useRef(pos);
  posRef.current = pos;
  const biRef = useRef(bi);
  biRef.current = bi;
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const busy = useRef(false);
  const askControllerRef = useRef<AbortController | null>(null);
  const historyRef = useRef(""); // running Q/A history for follow-ups
  const lastSpokenKey = useRef<string | null>(null);

  // Fit the fixed-size stage into the ACTUAL book area (the viewport minus the controls),
  // measured with a ResizeObserver. This guarantees the book always fits AND the control
  // bar below it stays fully visible — regardless of viewport size or how the controls wrap.
  const bookAreaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bookAreaRef.current;
    if (!el) return undefined;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 0 && height > 0) setScale(Math.min((width - 24) / STAGE_W, (height - 24) / STAGE_H, 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Settle onto a beat in the current chapter (walk if the keeper must move).
  const settle = useCallback((beat: Beat, idx: number) => {
    setBi(idx);
    const moved = beat.x !== posRef.current.x || beat.y !== posRef.current.y;
    setPos({ x: beat.x, y: beat.y, face: beat.face });
    if (moved) {
      setMoving(true);
      window.setTimeout(() => setMoving(false), 660);
    } else {
      setMoving(false);
    }
  }, []);

  // Go to a beat. Same chapter -> settle; different chapter -> page-turn sequence.
  const go = useCallback(
    (idx: number) => {
      if (busy.current) return;
      const beat = BEATS[idx];
      // Leaving an answer/queue view to resume the chapter content.
      setResult(null);
      if (beat.ch === chRef.current) {
        settle(beat, idx);
        return;
      }
      busy.current = true;
      const dir = beat.ch > chRef.current ? "fwd" : "back";
      // step to the seam to "turn" the page
      setPos({ x: 600, y: 528, face: dir === "fwd" ? "right" : "left" });
      setMoving(true);
      window.setTimeout(() => {
        pageSound();
        setFlip(dir);
        setCh(beat.ch); // swap the right page under the turning leaf
        window.setTimeout(() => {
          setFlip(null);
          setBi(idx);
          setPos({ x: beat.x, y: beat.y, face: beat.face });
          setMoving(true);
          window.setTimeout(() => {
            setMoving(false);
            busy.current = false;
          }, 680);
        }, 560);
      }, 340);
    },
    [settle],
  );

  // auto-tour — self-rescheduling timeout so timers can't stack or race
  useEffect(() => {
    if (!auto) return undefined;
    let alive = true;
    let timer: number;
    const tick = () => {
      if (!alive) return;
      if (!busy.current) go((biRef.current + 1) % BEATS.length);
      timer = window.setTimeout(tick, 5200);
    };
    timer = window.setTimeout(tick, 5200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [auto, go]);

  // manual interaction pauses the auto-tour
  const manual = useCallback((fn: () => void) => {
    setAuto(false);
    autoRef.current = false;
    fn();
  }, []);
  const step = useCallback((delta: number) => manual(() => go((biRef.current + delta + BEATS.length) % BEATS.length)), [manual, go]);
  const jumpChapter = useCallback(
    (chapter: number) =>
      manual(() => {
        const idx = BEATS.findIndex((beat) => beat.ch === chapter);
        if (idx >= 0) go(idx);
      }),
    [manual, go],
  );
  const turnPage = useCallback(
    () =>
      manual(() => {
        const nextCh = Math.min(ch + 1, CHAPTERS.length - 1);
        if (nextCh !== ch) {
          const idx = BEATS.findIndex((beat) => beat.ch === nextCh);
          if (idx >= 0) go(idx);
        }
      }),
    [manual, go, ch],
  );

  // play/pause the tour; resuming clears any answer so the chapter content returns
  const togglePlay = useCallback(() => {
    const next = !autoRef.current;
    if (next) setResult(null);
    setAuto(next);
  }, []);

  // Story = auto-tour; Ledger = paused, interactive (queue reachable, ask live).
  const selectMode = useCallback((next: "story" | "ledger") => {
    setMode(next);
    setResult(null);
    setAskError(null);
    setAuto(next === "story");
  }, []);

  // The real talk-to-data flow. Cancels any in-flight ask, appends to history for
  // follow-ups, and never throws (askData returns an ApiResult).
  const submitAsk = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setAskText("");
    setAuto(false);
    autoRef.current = false;
    setAskError(null);
    setAsking(true);

    // cancel the previous in-flight ask, if any
    askControllerRef.current?.abort();
    const controller = new AbortController();
    askControllerRef.current = controller;

    const response = await askData(trimmed, historyRef.current, controller.signal);
    if (controller.signal.aborted) return; // superseded by a newer ask — ignore silently
    setAsking(false);

    if (!response.ok) {
      if (response.aborted) return;
      // Show the keeper's error line as a calm, no-chart answer; never crash.
      setAskError(response.error);
      setResult({ answerText: response.error, narration: response.error, severity: 1, chart: { kind: "none", title: "", series: [] } });
      setAskSeq((seq) => seq + 1);
      return;
    }

    // keep a short rolling history so follow-ups ("compared to that…") resolve
    historyRef.current = `${historyRef.current}\nQ: ${trimmed}\nA: ${response.data.answerText}`.slice(-2000);
    setResult(response.data);
    setAskSeq((seq) => seq + 1);
  }, []);

  // ── derive the active narration / mood / pose for this render ──
  const beat = BEATS[bi];
  const view: LedgerView = { data, queue, approvals, reports, mode, answer: result, asking };
  const inQueue = mode === "ledger" && ch === 4 && !result && !asking && !!queue.current;
  const inApprovals = mode === "ledger" && ch === 5 && !result && !asking && !!approvals.current;
  // The trips chapter has no per-item queue; the keeper's mood follows the worst flag found
  // across all trip reports (0 when none have loaded yet).
  const tripsWorstSeverity = reports.reports.reduce(
    (worst, report) => report.violations.reduce((inner, violation) => Math.max(inner, violation.severity), worst),
    0,
  );

  let activeLine: string;
  let activeMood: Mood;
  let activePose: "idle" | "pointing";
  if (asking) {
    // interim reading line: typed but intentionally not voiced
    activeLine = "Let me read the ledger…";
    activeMood = "neutral";
    activePose = "idle";
  } else if (result) {
    activeLine = result.narration;
    activeMood = severityToMood(result.severity);
    activePose = "idle";
  } else if (inQueue && queue.current) {
    activeLine = queue.current.narration;
    activeMood = severityToMood(queue.current.severity);
    activePose = "idle";
  } else if (inApprovals && approvals.current) {
    // The keeper speaks the approval reasoning and emotes by the item's severity.
    activeLine = approvals.current.reasoning;
    activeMood = severityToMood(approvals.current.severity);
    activePose = "idle";
  } else if (ch === 6 && reports.reports.length > 0) {
    // Trips chapter: keep the beat's spoken line, but drive the mood from the worst flag.
    activeLine = beatLine(bi, view);
    activeMood = severityToMood(tripsWorstSeverity as Severity);
    activePose = beat.pose;
  } else {
    activeLine = beatLine(bi, view);
    activeMood = beat.mood;
    activePose = beat.pose;
  }

  // POI glow only during the scripted tour (never during an answer/queue/approval/walk)
  const activeTarget = result || asking || moving || flip || inQueue || inApprovals ? null : beat.target;
  const narrateKey = asking ? "asking" : result ? `ask-${askSeq}` : inQueue && queue.current ? `q-${queue.currentIndex}` : inApprovals && approvals.current ? `a-${approvals.currentIndex}` : `b-${bi}`;
  const narrating = !moving && !flip && !!activeLine;
  const sev = SEV[activeMood].c;

  // Render-first voice: when the active narration settles on a new line, speak it once.
  // The text/chart are already on screen (this is an effect, after paint). The interim
  // "reading" line (asking) is skipped so only real narration is voiced.
  useEffect(() => {
    if (narrating && activeLine && !asking && lastSpokenKey.current !== narrateKey) {
      lastSpokenKey.current = narrateKey;
      voice.play(activeLine);
    }
    // voice.play is stable (useCallback); intentionally not a dep
  }, [narrateKey, narrating, activeLine, asking]);

  // Memoize the page layers so they recompute only on a real content change — not on the
  // many pos/moving re-renders during a walk. `view` is rebuilt from the listed deps.
  const leftContent = useMemo(
    () => renderLeft(ch, activeTarget, view),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ch, activeTarget, data, mode, result, asking, queue.items, queue.currentIndex, queue.done, queue.counts, approvals.items, approvals.currentIndex, approvals.done, approvals.counts, approvals.loading, approvals.error, reports.reports, reports.loading, reports.error],
  );
  const rightContent = useMemo(
    () => renderRight(ch, activeTarget, view),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ch, activeTarget, data, mode, result, asking, queue.items, queue.currentIndex, queue.done, queue.counts, approvals.items, approvals.currentIndex, approvals.done, approvals.counts, approvals.loading, approvals.error, reports.reports, reports.loading, reports.error],
  );

  const renderPage = (side: "L" | "R") => <Paper style={{ flex: 1, borderRadius: side === "L" ? "8px 2px 2px 8px" : "2px 8px 8px 2px", overflow: "hidden" }} />;

  const statusLine = askError || voice.error || data.summaryError || data.violationsError;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <Backdrop>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* the book — flexible area; the stage scales to fit THIS measured box */}
          <div ref={bookAreaRef} style={{ flex: "1 1 auto", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
            <div style={{ width: STAGE_W * scale, height: STAGE_H * scale, position: "relative" }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "top left", perspective: 2000 }}>
                {/* book base */}
                <div style={{ position: "absolute", inset: 0, display: "flex", filter: "drop-shadow(0 26px 56px rgba(0,0,0,0.55))" }}>
                  {renderPage("L")}
                  {renderPage("R")}
                </div>

                {/* page content — stable, always-visible layers (data must always read) */}
                <div className="page-content" style={{ position: "absolute", inset: 0 }}>
                  {leftContent}
                </div>
                <div className="page-content" style={{ position: "absolute", inset: 0 }}>
                  {rightContent}
                </div>

                {/* the turning leaf */}
                {flip && (
                  <div className={"page-leaf " + flip} style={{ position: "absolute", left: STAGE_W / 2, top: 0, width: STAGE_W / 2, height: STAGE_H, zIndex: 30 }}>
                    <div className="leaf-face" />
                  </div>
                )}

                <Gutter style={{ left: "50%", transform: "translateX(-50%)", zIndex: 22 }} />
                <Keeper x={pos.x} y={pos.y} face={pos.face} mood={activeMood} pose={activePose} moving={moving} narrating={narrating} narrateKey={narrateKey} lineLen={activeLine ? activeLine.length : 0} />
                <DialogCaption line={activeLine} moving={moving} flip={flip} sev={sev} narrateKey={narrateKey} muted={voice.muted} onToggleMute={voice.toggleMute} />
              </div>
            </div>
          </div>

          {/* controls — pinned (never shrink), so they stay fully visible below the book */}
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 18px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontFamily: WF.data, fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: "#8c9a8a" }}>
                {data.loading ? "Reading the ledger…" : "Concept harness · generated for this ledger"}
              </span>
              <ModeRibbon mode={mode} onSelect={selectMode} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {CHAPTERS.map((chapter, index) => (
                <button
                  key={chapter.id}
                  onClick={() => jumpChapter(index)}
                  style={{
                    fontFamily: WF.data,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    color: index === ch ? "#fff" : "#bcae93",
                    background: index === ch ? WF.pumpkin : "transparent",
                    border: `1px solid ${index === ch ? WF.pumpkin : "rgba(239,226,201,0.22)"}`,
                    borderRadius: 20,
                    padding: "5px 13px",
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  {chapter.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CtrlBtn onClick={() => step(-1)} label="◀ Prev" />
              <CtrlBtn onClick={togglePlay} label={auto ? "❚❚ Pause" : "▶ Play tour"} primary />
              <CtrlBtn onClick={() => step(1)} label="Next ▶" />
              <CtrlBtn onClick={turnPage} label="Turn the page ↟" />
            </div>

            {/* the real ask field + quick prompts (all feed client.askData) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 820 }}>
              <input
                value={askText}
                onChange={(event) => setAskText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitAsk(askText);
                }}
                placeholder="Ask the keeper…"
                disabled={asking}
                style={{
                  fontFamily: WF.body,
                  fontSize: 13,
                  fontStyle: "italic",
                  color: WF.page,
                  background: "rgba(239,226,201,0.08)",
                  border: `1px solid ${WF.sepia}`,
                  borderRadius: 13,
                  padding: "7px 13px",
                  width: 240,
                  outline: "none",
                }}
              />
              <CtrlBtn onClick={() => submitAsk(askText)} label={asking ? "Reading…" : "Ask ↵"} primary />
              {QUICK_ASKS.map((question) => (
                <button
                  key={question}
                  onClick={() => submitAsk(question)}
                  disabled={asking}
                  style={{
                    fontFamily: WF.data,
                    fontSize: 12,
                    color: WF.page,
                    background: "rgba(239,226,201,0.08)",
                    border: "1px solid rgba(239,226,201,0.28)",
                    borderRadius: 13,
                    padding: "6px 13px",
                    cursor: asking ? "default" : "pointer",
                    opacity: asking ? 0.5 : 1,
                    transition: "background .15s",
                  }}
                >
                  {question}
                </button>
              ))}
            </div>

            {/* soft status line — errors degrade gracefully, never a white screen */}
            {statusLine && <div style={{ fontFamily: WF.data, fontSize: 11, color: WF.gold, maxWidth: 780, textAlign: "center" }}>{statusLine}</div>}
          </div>
        </div>
      </Backdrop>
    </div>
  );
}

function CtrlBtn({ onClick, label, primary = false }: { onClick: () => void; label: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: WF.data,
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: 0.3,
        color: primary ? "#fff" : WF.page,
        background: primary ? WF.pumpkin : "rgba(239,226,201,0.10)",
        border: `1px solid ${primary ? WF.pumpkin : "rgba(239,226,201,0.25)"}`,
        borderRadius: 6,
        padding: "8px 15px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
