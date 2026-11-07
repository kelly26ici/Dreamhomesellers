/**
 * The reduced-motion gate. A file that drives motion must ask about motion.
 *
 * The global `prefers-reduced-motion` block in globals.css collapses CSS
 * animations and transitions. It cannot see anything a JS engine owns, which
 * is why nine files in this repo ran their full animation set for visitors who
 * had asked for less: GSAP tweens, ScrollTrigger reveals, Lenis smooth scroll,
 * and two perpetual carousels are all invisible to CSS.
 *
 * So the rule is enforced here rather than remembered: if a file imports gsap
 * or lenis, it must import `usePrefersReducedMotion` from the design system.
 * The hook is the single answer to "does this visitor want less motion?", and
 * this script is what stops the next motion component from quietly not asking.
 *
 * Why a script and not an eslint rule: coverage is "every file that imports a
 * motion library", which is a property of the import graph, not of one file's
 * syntax. It is the same reason the contrast gate is a script.
 *
 * Usage: node scripts/verify-reduced-motion.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const HOOK = "usePrefersReducedMotion";
const MOTION_LIBRARIES = ["gsap", "lenis"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const missing = [];
let checked = 0;

for (const file of walk(SRC)) {
  const source = readFileSync(file, "utf8");
  const importsMotion = MOTION_LIBRARIES.some(
    (lib) => new RegExp(`from\\s+"${lib}(/[^"]*)?"`).test(source)
  );
  if (!importsMotion) continue;
  checked += 1;

  // Both halves are required, and they are checked separately on purpose. An
  // import with no call is dead weight that reads as compliance; a call with no
  // import does not compile. A mention in a comment is neither.
  const importsHook = /import\s*\{[^}]*usePrefersReducedMotion[^}]*\}\s*from\s*"[^"]*design-system"/.test(
    source
  );
  const callsHook = /usePrefersReducedMotion\s*\(\s*\)/.test(source);

  if (!importsHook || !callsHook) {
    const why = !importsHook && !callsHook
      ? "never imports or calls it"
      : !importsHook
        ? "calls it but does not import it from the design system"
        : "imports it but never calls it";
    missing.push(`${relative(ROOT, file)} — ${why}`);
  }
}

if (missing.length) {
  console.error(`FAIL: reduced motion (${missing.length} motion file(s) never ask)`);
  for (const file of missing) {
    console.error(`  - ${file}`);
  }
  console.error(
    `\nCSS cannot reach JS-driven motion. Import ${HOOK} from "@/shared/design-system", call it, and gate the effect.`
  );
  process.exit(1);
}

console.log(`PASS: ${checked} motion-driving file(s), all ask ${HOOK}()`);
