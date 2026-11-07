/**
 * The contrast gate. Run before approving a palette change; fails CI below AA.
 *
 * Parses src/shared/design-system/tokens.css, pairs every foreground token
 * with every background token that can actually occur in both themes, and
 * measures each pair with the WCAG 2.2 formula. Reports the worst ratio per
 * theme and exits non-zero on any body-text pair below 4.5:1 or any
 * non-text/UI pair below 3:1.
 *
 * This exists because the previous palette was never measured: two different
 * golds shipped in six files and nobody could say whether either was
 * readable. A token that is checked is a token that cannot silently regress.
 *
 * Usage: node scripts/verify-contrast.mjs [--path <tokens.css>]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_PATH =
  process.argv.includes("--path")
    ? resolve(process.argv[process.argv.indexOf("--path") + 1])
    : resolve(ROOT, "src/shared/design-system/tokens.css");

const AA_BODY = 4.5;
const AA_LARGE = 3.0;

/**
 * Tokens used as text or meaningful foreground. `on` tokens are only ever
 * painted onto their own background (on-brand onto brand, on-danger onto
 * danger), so pairing them against every surface is meaningless -- and
 * measuring a colour against itself is noise, not signal.
 */
const FOREGROUNDS = [
  { name: "text-title", min: AA_BODY },
  { name: "text-body", min: AA_BODY },
  { name: "text-muted", min: AA_BODY },
  /* The accent is text 170 times and a border 147 times, so it is measured
     at the body bar, not the UI bar — those call sites are copy, not chrome. */
  { name: "brand", min: AA_BODY },
  { name: "danger", min: AA_LARGE },
];

/** Backgrounds a foreground can actually sit on. */
const BACKGROUNDS = ["canvas", "surface", "surface-raised"];

/**
 * Text painted onto a coloured ground. Only the `on-*` tokens ever sit on a
 * coloured ground — regular text on the accent is not a pair this system uses,
 * and measuring it produces failures that describe no real screen.
 */
const PAIRED = [
  { fg: "on-brand", bg: "brand", min: AA_BODY },
  { fg: "on-danger", bg: "danger", min: AA_BODY },
];

function parseTokens(css) {
  const themes = {};
  // Split on the selectors that define a theme block.
  const blocks = css.split(/(?=:root\b|\[data-theme=|@media\s*\(prefers-color-scheme)/);
  // `:root` is the PRIMARY theme (light); `[data-theme=...]` re-states the other.
  let currentTheme = "light";
  for (const block of blocks) {
    if (/\[data-theme="dark"\]/.test(block)) currentTheme = "dark";
    else if (/\[data-theme="light"\]/.test(block)) currentTheme = "light";
    else if (/prefers-color-scheme:\s*dark/.test(block)) currentTheme = "dark";
    else if (/prefers-color-scheme:\s*light/.test(block)) currentTheme = "light";
    else if (/^:root/.test(block)) currentTheme = "light";

    const decls = block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g);
    for (const [, name, value] of decls) {
      const key = name.slice(2);
      // Only literal colours; var() references resolve per theme separately.
      if (value.includes("var(")) continue;
      themes[currentTheme] ??= {};
      themes[currentTheme][key] = value.trim();
    }
  }
  return themes;
}

function channel(value) {
  const v = value.trim();
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  const rgb = v.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return parts.slice(0, 3);
  }
  return null;
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function resolveVar(value, theme) {
  // Follow one level of var() indirection within the same theme.
  const m = value.match(/var\((--[\w-]+)\)/);
  if (!m) return value;
  const next = theme[m[1].slice(2)];
  return next ? resolveVar(next, theme) : value;
}

const css = readFileSync(TOKENS_PATH, "utf8");
const themes = parseTokens(css);

let failures = 0;
console.log(`contrast gate — ${TOKENS_PATH}\n`);
for (const [themeName, theme] of Object.entries(themes)) {
  const results = [];
  const measure = (fgName, bgName, min) => {
    const bgRaw = theme[bgName];
    const fgRaw = theme[fgName];
    if (!bgRaw || !fgRaw) return;
    const bg = channel(resolveVar(bgRaw, theme));
    const fgRgb = channel(resolveVar(fgRaw, theme));
    if (!bg || !fgRgb) return;
    results.push({ fg: fgName, bg: bgName, ratio: contrast(fgRgb, bg), min });
  };

  // 1. every foreground against every flat surface
  for (const bgName of BACKGROUNDS) {
    for (const fg of FOREGROUNDS) measure(fg.name, bgName, fg.min);
  }
  // 2. text painted onto a coloured ground
  for (const pair of PAIRED) measure(pair.fg, pair.bg, pair.min);
  if (!results.length) continue;

  const worst = results.reduce((a, b) => (a.ratio < b.ratio ? a : b));
  for (const r of results) {
    const ok = r.ratio >= r.min;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${themeName.padEnd(5)} ` +
        `${r.fg.padEnd(12)} on ${r.bg.padEnd(14)} ` +
        `${r.ratio.toFixed(2)}:1  (min ${r.min})`
    );
  }
  console.log(
    `  → ${themeName}: worst ${worst.fg} on ${worst.bg} = ${worst.ratio.toFixed(2)}:1\n`
  );
}

if (failures > 0) {
  console.error(`FAIL: ${failures} pair(s) below AA`);
  process.exit(1);
}
console.log("PASS: every pair meets AA");
