/**
 * app/layout.tsx
 * Root layout for the App Router (required — a page cannot build without one).
 * Two responsibilities:
 *   1. Load the storybook fonts the palette references *by name* (Cormorant Garamond,
 *      Spectral, IBM Plex Sans, Caveat). Loading them by name keeps the WF palette in
 *      tokens.ts as the single source of truth for typography — components keep using
 *      the literal family strings and they just resolve.
 *   2. Pull in globals.css, which carries the keeper + page-turn animation keyframes
 *      ported verbatim from the original standalone HTML host.
 * All interactive UI lives below this in client components.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Ledger of the Unknown — The Roaming Keeper",
  description: "Six months of fleet spending, read aloud by the keeper who guards it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Storybook typeface set, loaded by name (matches the original HTML host). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&family=IBM+Plex+Sans:wght@400;500;600&family=Caveat:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
