"use client";

/**
 * Theme toggle. One token set, two themes, stored per visitor.
 *
 * The choice is written to <html data-theme>, which is the single switch the
 * whole product reads: every colour in tokens.css hangs off that attribute,
 * so this component is the only place theme state exists. With no stored
 * choice the OS preference applies.
 *
 * The pre-paint reconciliation is a script in the root layout, not here. A
 * component that decided the theme after hydration would paint the wrong
 * theme first and then swap it, which is the flash this design exists twice
 * to avoid.
 */
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "luxonn:theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, setTheme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      aria-pressed={theme === "light"}
      data-theme-toggle
      /* Tailwind's own scales for radius, spacing, and duration — the token
         module owns colour, and globals.css already pins the radius scale
         (ADR-018). Reaching for spacing tokens that do not exist is how a
         class ends up silently producing no padding at all. */
      className="rounded-md border border-[var(--hairline)] px-3 py-2 text-sm text-[var(--text-body)] transition-colors duration-150 hover:text-[var(--text-title)] focus-visible:outline-2 focus-visible:outline-gold"
    >
      {next === "light" ? "Light" : "Dark"}
    </button>
  );
}
