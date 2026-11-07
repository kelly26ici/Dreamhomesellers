/**
 * The design system's single public surface.
 *
 * Import from here and nowhere else. The point of a barrel is that a
 * component's dependencies are visible in one line, and that there is exactly
 * one place to look when a token changes.
 *
 * The CSS itself is imported once, by `src/app/globals.css`; nothing else
 * should import tokens.css directly, or the token set stops being one set.
 */

export { TOKENS, tokens, type TokenName } from "./tokens";
export { ThemeToggle, useTheme, type Theme } from "./theme-toggle";
export { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
