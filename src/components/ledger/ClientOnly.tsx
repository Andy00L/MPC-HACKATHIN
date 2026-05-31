/**
 * components/ledger/ClientOnly.tsx
 * Renders children only after the component has mounted on the client. The server render
 * and the first client render both return the stable `fallback`, so they match and React
 * does not throw a hydration error. After mount, the real tree renders. This also means a
 * browser extension that mutates form-like DOM (Proton Pass injects data-protonpass-*
 * attributes) cannot cause a mismatch, because those nodes are never in the server HTML.
 *
 * This is React's recommended two-pass pattern for intentionally client-only content. The
 * cost is one extra render and a brief fallback frame before mount; that is the right
 * tradeoff here because it is the only way to keep extension-mutated form nodes out of the
 * server HTML entirely (suppressHydrationWarning only patches one node and is the wrong tool
 * against an extension that tags many).
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";

export function ClientOnly({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => setHasMounted(true), []);
  return <>{hasMounted ? children : fallback}</>;
}
