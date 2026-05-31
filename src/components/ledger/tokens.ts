/**
 * components/ledger/tokens.ts
 * The autumn-dusk storybook palette + the mood vocabulary and severity-label map.
 * This is the SINGLE copy of the design tokens (ported from the wireframe's wf-kit.jsx
 * `WF`/`SEV`). Every component imports colours/fonts from here; the palette is never
 * duplicated across files.
 */

// The palette. `as const` so each value is a literal type (typos in usage are caught,
// and the object is deeply readonly).
export const WF = {
  backdrop: "#1C2620",
  backdrop2: "#141B16",
  page: "#EFE2C9",
  page2: "#E4D2B0",
  ink: "#2B211A",
  inkSoft: "rgba(43,33,26,0.55)",
  pumpkin: "#BC5E2C",
  pine: "#33503F",
  gold: "#E7B24C",
  sepia: "#8A6F4E",
  sepiaSoft: "rgba(138,111,78,0.45)",
  sage: "#6E8A6A",
  ochre: "#C8923A",
  rust: "#9E3B2E",
  serif: '"Cormorant Garamond", Georgia, serif',
  body: '"Spectral", Georgia, serif',
  data: '"IBM Plex Sans", system-ui, sans-serif',
  hand: '"Caveat", "Comic Sans MS", cursive',
} as const;

// The keeper's three moods. The strings here are exactly what severityToMood() returns,
// so the badge label/colour, the dialog dot, and the keeper's face all read from one
// vocabulary and can never drift apart.
export type Mood = "neutral" | "concerned" | "alarmed";

// Mood -> colour + human label. Keyed by Mood so it stays exhaustive.
export const SEV: Record<Mood, { c: string; label: string }> = {
  neutral: { c: WF.sage, label: "Neutral" },
  concerned: { c: WF.ochre, label: "Concerned" },
  alarmed: { c: WF.rust, label: "Alarmed" },
};

// An ordered palette for chart segments/series, drawn from the same tokens. Charts cycle
// through this so a donut/bar with many slices stays on-brand without hardcoding colours.
export const SERIES_COLORS: readonly string[] = [
  WF.pumpkin,
  WF.pine,
  WF.gold,
  WF.sepia,
  WF.sage,
  WF.ochre,
  WF.rust,
];
