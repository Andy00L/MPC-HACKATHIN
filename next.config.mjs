/**
 * next.config.mjs
 * Minimal App Router config. ESLint is skipped during `next build` (we do not ship an
 * ESLint config in this project); TypeScript errors are NOT ignored, so the build still
 * fails on a real type error — which is the check we want to keep honest.
 *
 * serverExternalPackages keeps better-sqlite3 out of the server bundle: it is a native
 * module (a .node binary) that must be loaded with Node's require at runtime, not bundled
 * by webpack or turbopack. This is the stable Next 15 key (it replaced the deprecated
 * experimental.serverComponentsExternalPackages in 15.0.0, verified against the live docs).
 * Next already auto-externalizes better-sqlite3, but we list it so the intent is explicit
 * and survives any change to that built-in list.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
