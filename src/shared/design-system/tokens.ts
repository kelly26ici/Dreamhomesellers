/**
 * The typed mirror of tokens.css.
 *
 * This exists for one reason: a palette reachable only through CSS custom
 * properties cannot be used from a canvas, a gradient argument, a chart, or
 * an inline style, and the moment someone pastes a hex into one of those the
 * token system is over. So the names are mirrored here and
 * `scripts/test-design-tokens.mjs` parses the CSS every CI run and fails if
 * any of them drifts.
 *
 * Colour only. Spacing, radius, motion and the type scale stay in globals.css
 * with the rationale that pins them; copying them here would create a second
 * definition of the same fact.
 *
 * There is deliberately no `goldQuiet`, no `glassBg`, no `gradientGold`: a
 * second accent tier, a glass tint and a gradient were all banned by the
 * design rules this palette was chosen against, so they were removed rather
 * than left as unused tokens that read like an invitation.
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

  /* the one accent */
  brand: "var(--brand)",
  onBrand: "var(--on-brand)",

  /* separation — form fields and table rules, never surface-to-surface */
  hairline: "var(--hairline)",
  hairlineStrong: "var(--hairline-strong)",

  /* feedback */
  danger: "var(--danger)",
  onDanger: "var(--on-danger)",

  /* the single permitted shadow: menus and dialogs */
  shadowFloat: "var(--shadow-float)",
} as const;

export type TokenName = keyof typeof TOKENS;

/** Barrel: import { TOKENS } from "@/shared/design-system". */
export { TOKENS as tokens };
