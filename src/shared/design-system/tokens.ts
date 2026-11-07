/**
 * The typed mirror of tokens.css — colour only.
 *
 * This file exists for one reason: a palette that can only be reached through
 * CSS custom properties cannot be used from a canvas, a gradient argument, a
 * chart, or an inline style, and the moment someone pastes a hex into one of
 * those the token system is over. So the names are mirrored here and
 * `scripts/test-design-tokens.mjs` parses the CSS every CI run and fails if
 * any of them drifts.
 *
 * Spacing, radius, motion, and the type scale are deliberately NOT mirrored.
 * They are single-sourced in globals.css next to the rationale that pins them
 * (ADR-018), and copying them here would create a second definition of the
 * same fact. A token is not a module because it moved; it is one because
 * there is exactly one source for it.
 *
 * Use these names always as `var(...)`, so a theme switch is one attribute
 * change and never a re-render of hardcoded colour.
 */

export const TOKENS = {
  /* grounds */
  canvas: "var(--canvas)",
  surface: "var(--surface)",
  surfaceRaised: "var(--surface-raised)",

  /* text hierarchy */
  textTitle: "var(--text-title)",
  textBody: "var(--text-body)",
  textMuted: "var(--text-muted)",

  /* the accent: one hue, two tiers */
  gold: "var(--gold)",
  goldQuiet: "var(--gold-quiet)",
  onGold: "var(--on-gold)",

  /* separation */
  hairline: "var(--hairline)",
  hairlineStrong: "var(--hairline-strong)",

  /* feedback */
  danger: "var(--danger)",
  onDanger: "var(--on-danger)",

  /* glassmorphism (ADR-002) */
  glassBg: "var(--glass-bg)",
  glassBorder: "var(--glass-border)",
  glassBlur: "var(--glass-blur)",

  /* gradients (ADR-002) */
  gradientGold: "var(--gradient-gold)",
  gradientVeil: "var(--gradient-veil)",
} as const;

export type TokenName = keyof typeof TOKENS;

/** Barrel: import { TOKENS } from "@/shared/design-system". */
export { TOKENS as tokens };
