"use client";

import { ReactLenis } from "lenis/react";
import { usePrefersReducedMotion } from "@/shared/design-system";

/**
 * Global smooth scroll, for everyone except visitors who asked for less motion.
 *
 * Lenis is a JS scroll hijack: it drives the scroll position itself, so the
 * `prefers-reduced-motion` block in globals.css cannot see it and the whole
 * page keeps easing for someone who asked it not to. When the preference is
 * set, Lenis is simply not mounted and the browser's own scrolling stands —
 * which is already instant, already keyboard-friendly, and already correct.
 */
export default function SmoothScroll({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduced = usePrefersReducedMotion();

  if (reduced) return <>{children}</>;

  return (
    <ReactLenis root options={{ lerp: 0.05 }}>
      {children}
    </ReactLenis>
  );
}
