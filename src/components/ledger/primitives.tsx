/**
 * components/ledger/primitives.tsx
 * The kept wireframe primitives, ported to typed React. Consolidates the survivors of
 * BOTH wf-kit.jsx (Backdrop, Paper, Gutter, Stat, Chip, SevBadge) and wf-guide.jsx
 * (LedgerHead, ModeRibbon, ActionBtn). The wireframe-only annotations (Hatch/Note/
 * HandArrow) and the superseded keeper/dialog/ask pieces (GuideSketch/DialogBox/
 * AskField) are intentionally NOT ported.
 *
 * Visual treatment is preserved exactly; only the model changes (typed props, real
 * <button> elements for the interactive controls, palette pulled from tokens.ts).
 */
import type { CSSProperties, ReactNode } from "react";
import { WF, SEV, type Mood } from "./tokens";

// Procedural grain/fiber textures, copied verbatim from the wireframe so the parchment
// look is identical. Kept as module constants rather than recomputed per render.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";
const FIBER =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)' opacity='0.6'/%3E%3C/svg%3E\")";

// ─── Backdrop: dark forest-night surface with vignette + grain ───
export function Backdrop({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(120% 100% at 50% 38%, ${WF.backdrop} 0%, ${WF.backdrop2} 78%, #0d120f 100%)`,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.05, mixBlendMode: "overlay", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 220px 60px rgba(0,0,0,0.65)", pointerEvents: "none" }} />
      {children}
    </div>
  );
}

// ─── Paper: a parchment panel with deckle edge + optional gold inner rule ───
export function Paper({
  children,
  style,
  rule = true,
  deeper = false,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  rule?: boolean;
  deeper?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: deeper ? WF.page2 : WF.page,
        borderRadius: "5px 7px 6px 8px",
        boxShadow: "inset 0 0 60px rgba(138,111,78,0.18)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ position: "absolute", inset: 0, backgroundImage: FIBER, opacity: 0.06, mixBlendMode: "multiply", pointerEvents: "none" }} />
      {rule && <div style={{ position: "absolute", inset: 14, border: `1px solid ${WF.sepiaSoft}`, borderRadius: 3, pointerEvents: "none" }} />}
      {children}
    </div>
  );
}

// ─── Gutter: soft shadow for the book seam ───
export function Gutter({ style }: { style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        width: 56,
        background:
          "linear-gradient(90deg, rgba(60,40,20,0) 0%, rgba(60,40,20,0.28) 46%, rgba(60,40,20,0.34) 50%, rgba(60,40,20,0.28) 54%, rgba(60,40,20,0) 100%)",
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}

// ─── Stat: illuminated-manuscript headline number ───
export function Stat({ value, label, accent = WF.ink }: { value: ReactNode; label: string; accent?: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: WF.data, fontWeight: 600, fontSize: 30, color: accent, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: WF.data, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: WF.inkSoft, marginTop: 6 }}>{label}</div>
    </div>
  );
}

// ─── Chip: reasoning / suggestion pill ───
type ChipTone = "plain" | "sev" | "warn" | "ask";
export function Chip({ children, tone = "plain", style }: { children: ReactNode; tone?: ChipTone; style?: CSSProperties }) {
  const tones: Record<ChipTone, { bg: string; bd: string; fg: string }> = {
    plain: { bg: "rgba(138,111,78,0.12)", bd: WF.sepiaSoft, fg: WF.ink },
    sev: { bg: "rgba(158,59,46,0.12)", bd: "rgba(158,59,46,0.5)", fg: WF.rust },
    warn: { bg: "rgba(200,146,58,0.16)", bd: "rgba(200,146,58,0.55)", fg: "#8a6320" },
    ask: { bg: WF.page2, bd: WF.sepiaSoft, fg: WF.ink },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 11,
        border: `1px solid ${t.bd}`,
        background: t.bg,
        color: t.fg,
        fontFamily: WF.data,
        fontSize: 11.5,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ─── SevBadge: severity tag. Takes a mood string; call sites feed severityToMood(). ───
export function SevBadge({ level = "neutral", style }: { level?: Mood; style?: CSSProperties }) {
  const s = SEV[level];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 4,
        background: s.c,
        color: "#fff",
        fontFamily: WF.data,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        ...style,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: "#fff", opacity: 0.9 }} />
      {s.label}
    </span>
  );
}

// ─── LedgerHead: section/passage heading for the right (ledger) page ───
export function LedgerHead({ kicker, title, style }: { kicker?: string; title: ReactNode; style?: CSSProperties }) {
  return (
    <div style={style}>
      {kicker && <div style={{ fontFamily: WF.data, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: WF.pumpkin, marginBottom: 4 }}>{kicker}</div>}
      <div style={{ fontFamily: WF.serif, fontWeight: 600, fontSize: 26, color: WF.ink, lineHeight: 1.05 }}>{title}</div>
    </div>
  );
}

// ─── ModeRibbon: Story / Ledger bookmark toggle. Now interactive (onSelect). ───
type LedgerMode = "story" | "ledger";
export function ModeRibbon({ mode = "story", onSelect, style }: { mode?: LedgerMode; onSelect?: (mode: LedgerMode) => void; style?: CSSProperties }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", ...style }}>
      <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", boxShadow: "0 3px 8px rgba(0,0,0,0.3)" }}>
        {(["Story", "Ledger"] as const).map((label) => {
          const value = label.toLowerCase() as LedgerMode;
          const on = value === mode;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onSelect?.(value)}
              aria-pressed={on}
              style={{
                padding: "6px 13px",
                fontFamily: WF.data,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.4,
                border: "none",
                cursor: "pointer",
                background: on ? WF.pumpkin : WF.page2,
                color: on ? "#fff" : WF.inkSoft,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {/* little pointer under the active segment */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: "7px solid transparent",
          borderRight: "7px solid transparent",
          borderTop: `9px solid ${mode === "story" ? WF.pumpkin : WF.page2}`,
          marginTop: -1,
          marginLeft: mode === "story" ? -38 : 38,
        }}
      />
    </div>
  );
}

// ─── ActionBtn: review control with keyboard hint. Now a real <button>. ───
type BtnTone = "plain" | "pine" | "pumpkin" | "rust";
export function ActionBtn({
  label,
  kbd,
  tone = "plain",
  onClick,
  disabled = false,
  style,
}: {
  label: string;
  kbd: string;
  tone?: BtnTone;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const tones: Record<BtnTone, { bg: string; fg: string; bd: string }> = {
    plain: { bg: WF.page2, fg: WF.ink, bd: WF.sepia },
    pine: { bg: WF.pine, fg: "#EFE2C9", bd: WF.pine },
    pumpkin: { bg: WF.pumpkin, fg: "#fff", bd: WF.pumpkin },
    rust: { bg: WF.rust, fg: "#fff", bd: WF.rust },
  };
  const t = tones[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={kbd}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "9px 12px",
        background: t.bg,
        color: t.fg,
        border: `1.5px solid ${t.bd}`,
        borderRadius: 5,
        fontFamily: WF.data,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {label}
      <span style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.85, border: "1px solid currentColor", borderRadius: 3, padding: "0 4px", lineHeight: "14px" }}>{kbd}</span>
    </button>
  );
}
