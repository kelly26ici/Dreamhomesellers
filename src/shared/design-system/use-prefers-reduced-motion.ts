"use client";

/**
 * The one place the product asks "does this visitor want less motion?"
 *
 * The global `prefers-reduced-motion` block in globals.css collapses CSS
 * animations and transitions, and it does that well. It cannot reach anything
 * a JS engine owns: GSAP tweens, ScrollTrigger reveals, Lenis smooth scroll,
 * and the two perpetual carousels are all invisible to it. That is why six
 * components used to run their full animation set for a visitor who had
 * explicitly asked them not to — and why `Navbar.tsx` had a private copy of
 * this check that read the media query once at module scope and so never saw a
 * preference change.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: it subscribes, so
 * a mid-session preference change takes effect without a reload, and it keeps
 * the server and client snapshots separate, so hydration does not flip the
 * tree. This is the same pattern `TestimonialsV2.tsx` already uses for its
 * mount gate; it is the repo's answer to "subscribe to something outside
 * React".
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/** The server renders without a preference; dark is the default there already. */
function getServerSnapshot() {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
