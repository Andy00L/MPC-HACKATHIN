/**
 * app/page.tsx
 * The thin client entry. The whole experience is the RoamApp orchestrator; this mounts it
 * behind a client-only gate. RoamApp and every interactive descendant are client components
 * (state, effects, audio, keyboard), so this page opts into the client too.
 *
 * Why the gate: RoamApp renders a text <input> (the "Ask the keeper" field). Browser
 * password managers such as Proton Pass inject attributes (data-protonpass-*) onto form-like
 * nodes before React hydrates, which made the client tree diverge from the server HTML and
 * threw a hydration mismatch. ClientOnly renders a stable, form-free fallback for both the
 * server render and the first client render (so they match), then swaps in RoamApp after
 * mount, so those extension-mutated nodes are never part of the server HTML. This is React's
 * recommended two-pass pattern, not a suppressHydrationWarning patch.
 */
"use client";

import { RoamApp } from "@/components/ledger/RoamApp";
import { ClientOnly } from "@/components/ledger/ClientOnly";
import { WF } from "@/components/ledger/tokens";

// The pre-mount placeholder. It must: (a) read no `window` so it is deterministic, (b)
// contain no form-like elements so the extension has nothing to tag in the server HTML, and
// (c) share RoamApp's full-bleed fixed footprint so the swap to the real tree does not shift
// layout. The colour is the WF.backdrop palette token, never a hardcoded hex.
const ledgerFallback = (
  <div
    style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: WF.backdrop,
      color: WF.page,
      fontFamily: WF.data,
      fontSize: 13,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      opacity: 0.7,
    }}
  >
    Opening the ledger…
  </div>
);

export default function Page() {
  return <ClientOnly fallback={ledgerFallback}><RoamApp /></ClientOnly>;
}
