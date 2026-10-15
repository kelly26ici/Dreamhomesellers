"use client";

/**
 * Client-only R3F sparkle canvas for the login ambient background — same
 * treatment as TestimonialsV2, loaded via next/dynamic({ ssr: false }) from
 * login-form.tsx so three.js stays out of the /login initial bundle.
 */

import SparkleScene from "@/components/testimonials-v2/SparkleScene";

export default function LoginSparkles({
  scale,
  size,
  speed,
}: {
  readonly scale: [number, number, number];
  readonly size: number;
  readonly speed: number;
}) {
  return <SparkleScene scale={scale} size={size} speed={speed} />;
}
