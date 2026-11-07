# Frontend Performance Audit — Landing Page Bundling

**Date:** 2026-10-15 · **Scope:** three.js / @react-three, gsap, framer-motion, lenis import patterns on the homepage (`/`) and `/login`, `/gallery`
**Verified:** `npx tsc --noEmit` exit 0 · `npm run lint` 3341→3339 problems (one pre-existing error fixed, zero added)

## Findings

### 1. three.js statically bundled into the landing page's initial JS — FIXED

`src/components/testimonials-v2/TestimonialsV2.tsx:7-8` imported `Canvas` from `@react-three/fiber` and `Sparkles` from `@react-three/drei` at module top level, and `src/app/page.tsx:8` imports `TestimonialsV2` **statically** (not via `next/dynamic`). This pulled `three` (~600KB gzipped) into the homepage's initial JS chunk — the single highest-impact bundling problem on the page.

- `src/app/page.tsx:8` — static `import TestimonialsV2`
- `src/components/testimonials-v2/TestimonialsV2.tsx:7-8` — static `@react-three/fiber` + `@react-three/drei` imports

**Fix applied (minimal, behavior-preserving):**
- New `src/components/testimonials-v2/SparkleScene.tsx` — client component holding the exact `<Canvas><Sparkles/></Canvas>` subtree that was inline in TestimonialsV2 (props: `scale`, `size`, `speed`, `count`; identical dpr/camera/gl settings, identical gold `#d4a95f`).
- `TestimonialsV2.tsx` now loads it via `dynamic(() => import("./SparkleScene"), { ssr: false })`. Mount-gated render (`mounted && !reduceMotion`) is unchanged, so nothing renders during SSR/hydration either way.
- Same extraction for `/login`: new `src/components/ui/LoginSparkles.tsx` (wraps `SparkleScene` with the login-specific `scale=[24,12,4], size=2.4, speed=0.2` props); `src/components/ui/login-form.tsx:11-12` no longer imports `@react-three/*` directly.
- `npx tsc --noEmit` → no errors. `npm run lint` → problems 3341→3339, errors 177→176.

### 2. SmoothScroll (lenis) — correctly scoped, one caveat

`src/app/layout.tsx:33-38` wraps the whole app in `<SmoothScroll>` (ReactLenis root, lerp 0.05). `src/components/SmoothScroll.tsx` is a proper client boundary; `lenis/react` is tree-shakeable (named imports only). Caveat: this means lenis ships on **every** route including `/login` and `/gallery` where smooth scrolling serves little purpose — acceptable, not changed.

### 3. gsap / framer-motion — tree-shakeable, no change needed

- gsap: all consumers import `gsap` + `gsap/ScrollTrigger` named, register once at module scope (`FeaturedProperties.tsx:12-14`, `About.tsx:6-8`, `Services.tsx:5-7`, `Contact.tsx:5-7`, `VideoSection.tsx:5-7`, `TestimonialsV2.tsx:10-11`, `Navbar.tsx:5`), and use `gsap.context()` with cleanup in every consumer — correct pattern.
- framer-motion: only `motion`, hooks, and `useReducedMotion` are imported (`TestimonialsV2.tsx:12-18`, `login-form.tsx`) — named imports, tree-shakeable.

### 4. 'use client' usage — mostly justified, three could be server components

- `Footer.tsx` is already a **server component** (no directive; uses `"use cache"`).
- `PropertyShowcase.tsx` is already a **server component** — good.
- Could be server components (GSAP/scroll-reveal only, no state, no events): `src/components/About.tsx`, `src/components/Services.tsx`, `src/components/FeaturedProperties.tsx`, `src/components/VideoSection.tsx` (unused anywhere in `src/`). Left as-is — converting them would require extracting GSAP tweens to child client components, which is a redesign-adjacent refactor beyond the mandate.
- Justified client: `Navbar.tsx` (scroll state, lenis, menu), `Contact.tsx` (form state), `TestimonialsV2.tsx`, `login-form.tsx` (auth, forms), `SmoothScroll.tsx`.

### 5. next/image vs raw `<img>` — one raw `<img>` found

- `next/image` used correctly with `fill` + `sizes` in `About.tsx`, `VideoSection.tsx`, `TestimonialsV2.tsx` (avatars, 48px).
- **Raw `<img>`**: `src/components/circular-gallery.tsx:146` uses a raw `<img>` (with `object-cover`) for gallery card imagery. Not changed — `/gallery` is a separate route (not the landing page), and the img there renders inside a CSS 3D transform carousel where next/image's wrapper div can break the preserve-3d chain; migrating it is a behavior-risk change out of scope.

### 6. next/font vs CSS @font-face / Google Fonts link — correct

`src/app/layout.tsx:2,9-20` uses `next/font/google` (`Bebas_Neue`, `Inter`) with CSS variables; no `@font-face` and no `<link>` to `fonts.googleapis.com` anywhere in `src/app/globals.css` or layout. No change needed.

### 7. Other observations (informational, no action taken)

- `src/components/VideoSection.tsx` — imported by nothing in `src/`; dead code (GSAP + next/image included). Candidate for deletion, out of scope.
- `circular-gallery.tsx` uses requestAnimationFrame + CSS 3D transforms, **not** three.js — the `/gallery` page does not bundle three at all (good).
- The mount gates in `TestimonialsV2.tsx` / `login-form.tsx` use `useSyncExternalStore` for hydration-safe canvas gating — correct pattern, reused for the fix.

## STATUS: COMPLETE
