/**
 * components/ledger/Keeper.tsx
 * The keeper — real painterly sprites, eye-normalized so swaps never jump — plus the
 * DialogCaption (which owns its own typewriter) and the useTypewriter hook. Ported from
 * roam-app.jsx's sprite Keeper/DialogCaption/useTypewriter, which SUPERSEDE wf-guide's
 * GuideSketch/DialogBox.
 *
 * Faithful to the original sprite logic (walk cycle, mouth-flap by mood, point pose, the
 * preload cache). Three deliberate adaptations for Next:
 *   - SPR_DIR is the ABSOLUTE public path "/keeper/norm/" (the original relative
 *     "keeper/norm/" 404s under Next routing).
 *   - the preload loop is guarded with `typeof window` so it runs on the client exactly
 *     as before, but is a no-op during SSR where Image is undefined.
 *   - per the asset decision, concerned/alarmed now carry two frames each (talk-2/talk-3
 *     and talk-4/talk-5) so every mood mouth-flaps while the keeper speaks.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { WF, type Mood } from "./tokens";

const SPR_DIR = "/keeper/norm/"; // absolute public path (was the relative "keeper/norm/")
const KEEPER_W = 150;
const KEEPER_H = Math.round((150 * 530) / 410); // uniform canvas aspect (~194)

// Severity (via mood) is the single source of truth: mood -> face sprite set.
const KEEPER_SPRITES: { walk: string[]; point: string; idle: Record<Mood, string[]> } = {
  walk: ["walk-0", "walk-1", "walk-2", "walk-3", "walk-4", "walk-5"], // walk cycle
  point: "point", // arm extended
  idle: {
    neutral: ["talk-0", "talk-1"], // [0] mouth shut, flaps to [1] while speaking
    concerned: ["talk-2", "talk-3"], // enriched: talk-3 is the open-mouth frame
    alarmed: ["talk-4", "talk-5"], // enriched: talk-5 is the open-mouth frame
  },
};

// Preload every frame so src swaps are instant (no flash). Guarded for SSR: Image is
// undefined on the server, so this runs only in the browser — same timing as the original.
const _keeperCache: Record<string, HTMLImageElement> = {};
if (typeof window !== "undefined") {
  const allFrames = [...KEEPER_SPRITES.walk, KEEPER_SPRITES.point, ...Object.values(KEEPER_SPRITES.idle).flat()];
  for (const name of allFrames) {
    const img = new Image();
    img.src = SPR_DIR + name + ".png";
    _keeperCache[name] = img;
  }
}

export interface KeeperProps {
  x: number;
  y: number;
  face: "left" | "right";
  mood: Mood;
  pose: "idle" | "pointing";
  moving: boolean;
  narrating: boolean;
  narrateKey: string;
  lineLen: number;
}

export function Keeper({ x, y, face, mood, pose, moving, narrating, narrateKey, lineLen }: KeeperProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (moving) {
      // Walk cycle: step through walk-0..5.
      let i = 0;
      const id = setInterval(() => {
        i = (i + 1) % KEEPER_SPRITES.walk.length;
        setFrame(i);
      }, 105);
      return () => clearInterval(id);
    }
    if (narrating && pose !== "pointing") {
      // Mouth-flap for the duration of the line, then rest on the closed-mouth frame.
      const frames = KEEPER_SPRITES.idle[mood] ?? KEEPER_SPRITES.idle.neutral;
      if (frames.length < 2) {
        // single-frame mood (shouldn't happen now both are enriched, but stays safe)
        setFrame(0);
        return undefined;
      }
      let i = 0;
      const flap = setInterval(() => {
        i = (i + 1) % frames.length;
        setFrame(i);
      }, 190);
      const stop = setTimeout(() => {
        clearInterval(flap);
        setFrame(0);
      }, Math.min((lineLen || 40) * 22 + 300, 5000));
      return () => {
        clearInterval(flap);
        clearTimeout(stop);
      };
    }
    // idle, not narrating: rest on the closed-mouth frame
    setFrame(0);
    return undefined;
  }, [moving, narrating, narrateKey, pose, mood, lineLen]);

  // Pick the current sprite name from the state machine.
  let name: string;
  if (moving) name = KEEPER_SPRITES.walk[frame % KEEPER_SPRITES.walk.length];
  else if (pose === "pointing") name = KEEPER_SPRITES.point;
  else {
    const frames = KEEPER_SPRITES.idle[mood] ?? KEEPER_SPRITES.idle.neutral;
    name = frames[frame % frames.length];
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        zIndex: 24,
        transform: `translate(${x}px, ${y}px) translate(-50%, -52%)`,
        transition: "transform .64s cubic-bezier(.45,.05,.25,1)",
        pointerEvents: "none",
      }}
    >
      <div className={moving ? "keeper-bob keeper-walk" : "keeper-bob"}>
        <div style={{ position: "relative", width: KEEPER_W, height: KEEPER_H }}>
          {/* warm lantern aura — softly pulsing (animation in globals.css) */}
          <div
            className="keeper-glow"
            style={{
              position: "absolute",
              left: "46%",
              top: "64%",
              width: 300,
              height: 300,
              transform: "translate(-50%,-50%)",
              borderRadius: "50%",
              zIndex: 0,
              pointerEvents: "none",
              background: "radial-gradient(circle, rgba(231,178,76,0.30) 0%, rgba(231,178,76,0.10) 42%, rgba(231,178,76,0) 70%)",
              filter: "blur(3px)",
            }}
          />
          <div style={{ position: "relative", zIndex: 1, transform: face === "left" ? "scaleX(-1)" : "none", transition: "transform .18s" }}>
            {/* Sprite frames are swapped imperatively (src changes) against the preload
                cache for instant, flash-free changes — next/image would fight that, so a
                plain <img> is intentional here. */}
            <img
              src={SPR_DIR + name + ".png"}
              width={KEEPER_W}
              height={KEEPER_H}
              alt=""
              draggable={false}
              style={{ display: "block", filter: "drop-shadow(0 9px 11px rgba(20,12,4,0.32))" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * useTypewriter — reveals `text` one character at a time (~22ms/char). Restarts whenever
 * `startKey` changes, so a new line begins typing from empty.
 */
export function useTypewriter(text: string, startKey: string): string {
  const [out, setOut] = useState("");
  useEffect(() => {
    setOut("");
    if (!text) return undefined;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [startKey, text]);
  return out;
}

export interface DialogCaptionProps {
  line: string;
  moving: boolean;
  flip: "fwd" | "back" | null;
  sev: string; // the mood colour for the speaking dot
  narrateKey: string;
  muted: boolean;
  onToggleMute: () => void;
}

/**
 * DialogCaption — owns its own typewriter so the ~22ms ticks re-render ONLY this card,
 * never the whole book (which would churn the page layers and stall the tour). The mute
 * affordance is now a real toggle wired to the voice controller.
 */
export function DialogCaption({ line, moving, flip, sev, narrateKey, muted, onToggleMute }: DialogCaptionProps) {
  const typed = useTypewriter(moving ? "" : line, narrateKey + (moving ? "m" : "a"));
  return (
    <div style={{ position: "absolute", left: 70, bottom: 28, width: 470, zIndex: 26 }}>
      <div style={{ position: "relative", background: WF.page2, border: `1.5px solid ${WF.sepiaSoft}`, borderRadius: 6, padding: "14px 16px", boxShadow: "0 8px 22px rgba(0,0,0,0.22), inset 0 0 26px rgba(138,111,78,0.16)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: sev }} />
            <span style={{ fontFamily: WF.data, fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: WF.inkSoft }}>
              The Keeper {flip ? "· turning the page" : moving ? "· walking" : "· speaking"}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={muted}
            style={{ fontFamily: WF.data, fontSize: 9.5, color: WF.inkSoft, border: `1px solid ${WF.sepiaSoft}`, borderRadius: 3, padding: "1px 7px", background: "transparent", cursor: "pointer" }}
          >
            {muted ? "unmute ⏿" : "mute ⏿"}
          </button>
        </div>
        <div style={{ fontFamily: WF.body, fontSize: 17, lineHeight: 1.45, color: WF.ink, minHeight: 50 }}>
          {typed}
          <span style={{ borderRight: `2px solid ${WF.pumpkin}`, marginLeft: 1, opacity: moving || flip ? 0 : 1 }}>&nbsp;</span>
        </div>
      </div>
    </div>
  );
}
