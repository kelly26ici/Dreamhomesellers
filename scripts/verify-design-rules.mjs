/**
 * The design-rules gate. Glass and gradients are banned, and this is what
 * stops them coming back.
 *
 * The taste skill's house rules ban three things outright as decoration:
 * glassmorphism ("no backdrop blur panels"), gradients ("not as backgrounds,
 * not on buttons, not in text"), and shadows on things at rest. The first two
 * need no judgement -- there is no legitimate blur panel in a product
 * interface that follows these rules -- so they are checked mechanically.
 *
 * Shadows need judgement (a menu and a dialog legitimately float), so they are
 * reported but not failed, because a gate that cries wolf gets switched off.
 *
 * The one sanctioned exception is a neutral scrim under text on a photograph,
 * and it must be declared with `design-allow: scrim` on the line. Anything
 * else that wants an exception has to say so, in the file, next to the code.
 *
 * Usage: node scripts/verify-design-rules.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const GLASS = /backdrop-blur|backdrop-filter/;
const GRADIENT = /bg-gradient-to-|bg-\[radial-gradient|bg-\[linear-gradient/;
const SHADOW = /shadow-\[|shadow-(?:sm|md|lg|xl|2xl)\b/;

/**
 * Files that are not ours to edit, and the one in-file escape hatch.
 *
 * `src/components/assistant-ui/**` is the vendored registry composition set,
 * kept verbatim on purpose (it is a fork of upstream source, and its
 * underlying package is headless). Its fade masks are gradients that go from
 * the surface colour to transparent -- the sanctioned scrim, used as a mask
 * rather than as decoration -- and its blur is the package's own. Editing them
 * would fork the vendor's code for a rule they are not breaking.
 */
const VENDORED = /^src[\/]components[\/]assistant-ui[\/]/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const glass = [];
const gradients = [];
const shadows = [];
let files = 0;

for (const file of walk(SRC)) {
  files += 1;
  const rel = relative(ROOT, file);

  // walk() hands back absolute paths, so the vendored check has to run on the
  // repo-relative one -- testing the absolute path against this regex silently
  // matched nothing and let the vendored files through.
  if (VENDORED.test(rel.split("\\").join("/"))) continue;

  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  for (const [i, line] of lines.entries()) {
    if (line.trim().startsWith("//")) continue;

    if (GLASS.test(line)) glass.push(`${rel}:${i + 1}`);
    if (GRADIENT.test(line) && !/design-allow:\s*scrim/.test(line)) {
      gradients.push(`${rel}:${i + 1}`);
    }
    if (SHADOW.test(line)) shadows.push(`${rel}:${i + 1}`);
  }
}

const failures = glass.length + gradients.length;

if (failures > 0) {
  console.error(`FAIL: design rules (${failures} banned decoration(s) in ${files} files)`);
  if (glass.length) {
    console.error(`\n  glassmorphism (${glass.length}) — "no backdrop blur panels":`);
    for (const g of glass.slice(0, 25)) console.error(`    ${g}`);
    if (glass.length > 25) console.error(`    ...and ${glass.length - 25} more`);
  }
  if (gradients.length) {
    console.error(`\n  gradients (${gradients.length}) — "not as backgrounds, not on buttons":`);
    for (const g of gradients.slice(0, 25)) console.error(`    ${g}`);
    if (gradients.length > 25) console.error(`    ...and ${gradients.length - 25} more`);
  }
  console.error(
    "\n  A neutral scrim under text on a photograph is the one exception: mark the line `design-allow: scrim`."
  );
  process.exit(1);
}

console.log(
  `PASS: no glass, no gradients in ${files} files (${shadows.length} shadow(s) reported for judgement, not failed)`
);
