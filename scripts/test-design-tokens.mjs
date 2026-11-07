/**
 * tokens.ts and tokens.css must agree, in both themes.
 *
 * A typed mirror that drifts is worse than no mirror: it looks authoritative
 * and is quietly wrong, and the first thing that breaks is a canvas or a
 * gradient that renders a hex nobody chose. This script parses the CSS the
 * way the contrast gate does and asserts every name in TOKENS points at a
 * real custom property in both themes, so drift is a CI failure rather than a
 * surprise in a browser.
 *
 * It is a node script, not a vitest file, because this repo has no test
 * runner and adding one to check 19 names would be more setup than the check.
 *
 * Usage: node scripts/test-design-tokens.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_PATH = resolve(ROOT, "src/shared/design-system/tokens.css");
const TS_PATH = resolve(ROOT, "src/shared/design-system/tokens.ts");

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const css = readFileSync(CSS_PATH, "utf8");
const ts = readFileSync(TS_PATH, "utf8");

/* The named token block for each theme, parsed the same way as the gate. */
function block(selector) {
  const start = css.indexOf(selector);
  check(start > -1, `selector not found in tokens.css: ${selector}`);
  const end = css.indexOf("}", start);
  const out = {};
  for (const m of css.slice(start, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1].slice(2)] = m[2].trim();
  }
  return out;
}

const dark = block(":root {");
const light = block('[data-theme="light"] {');

/* Colour lives in both theme blocks. Everything else is not this module's. */
const THEMELESS = [
  "--space-",
  "--radius-",
  "--duration-",
  "--ease-",
  "--font-",
];

/* Every var() the TypeScript mirror hands out. */
const mirrored = [...ts.matchAll(/"var\((--[\w-]+)\)"/g)].map((m) => m[1].slice(2));

check(mirrored.length >= 15, `expected at least 15 mirrored tokens, found ${mirrored.length}`);

for (const name of mirrored) {
  check(name in dark, `${name} is missing from the :root block of tokens.css`);
  /* A derived token follows the theme through its own variables. */
  if (derived(name)) continue;
  check(name in light, `${name} is missing from the light block of tokens.css`);
}

/* A token is theme-independent when its value is *composed* of other theme
   tokens: `--gradient-gold: linear-gradient(..., var(--gold), ...)` follows
   whichever theme is on without a second copy, and duplicating it in the light
   block would create two definitions of one gradient that could drift apart.
   Only primitive values need to be restated per theme. */
function derived(key) {
  const value = dark[key];
  if (!value) return false;
  const vars = value.match(/var\(--[\w-]+\)/g) ?? [];
  if (!vars.length) return false;
  const stripped = vars.reduce((acc, v) => acc.replace(v, ""), value);
  return !/#[0-9a-fA-F]{3,8}\b/.test(stripped);
}

for (const key of Object.keys(dark)) {
  if (THEMELESS.some((p) => key.startsWith(p)) || derived(key)) continue;
  check(key in light, `${key} is defined dark-only`);
}
for (const key of Object.keys(light)) {
  if (THEMELESS.some((p) => key.startsWith(p)) || derived(key)) continue;
  check(key in dark, `${key} is defined light-only`);
}

/* No raw hex anywhere in the TypeScript mirror. The CSS file is the only
   place colour is written down. */
check(!/#[0-9a-fA-F]{3,8}\b/.test(ts), "tokens.ts contains a raw hex value");

if (failures.length) {
  console.error(`FAIL: design tokens (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `PASS: ${mirrored.length} tokens mirrored, ${Object.keys(dark).length} dark + ${Object.keys(light).length} light agree, no hex in tokens.ts`
);
