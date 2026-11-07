/**
 * The migration gate. A .sql file must be SQL, and it must end as SQL.
 *
 * While drafting 0020 I pasted review findings straight into the working
 * file and then committed it with them: nineteen lines of English prose sat
 * after `COMMIT;`, uncommented. The file could not be applied at all. It was
 * caught by reading the end of the file, which is not a check -- it is luck.
 *
 * This makes it a check. Two rules, both cheap and both specific:
 *
 *   1. No line may carry a review-transcript marker. Those are the words an
 *      assistant uses when narrating its own work ("I'll review...", "##
 *      Review"), and no migration has ever needed them.
 *
 *   2. The last non-blank, non-comment line must terminate a statement with
 *      `;`. Prose appended after the final COMMIT is exactly what this
 *      rejects.
 *
 * It does not parse PostgreSQL -- there is no database here and inventing a
 * parser would be worse than the problem. It rejects the one failure mode
 * that actually happened, and it says so when it does.
 *
 * Usage: node scripts/verify-migrations.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase/migrations");

/** Phrases that belong in a review comment, never in a migration file. */
const PROSE_MARKERS = [
  "I'll review",
  "I checked the project",
  "I found the current policies",
  "I will check",
  "I'll check",
  "I'll verify",
  "Let me review",
  "## Review",
  "## Policy review",
  "## Critical issue",
  "## Still outstanding",
  "Supabase docs confirm",
  "Your current policy list",
  "- The referenced tables",
];

const failures = [];
let files = 0;

if (statSync(MIGRATIONS, { throwIfNoEntry: false })) {
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    files += 1;
    const file = join(MIGRATIONS, name);
    const rel = relative(ROOT, file);
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (line.trim().startsWith("--")) continue;
      for (const marker of PROSE_MARKERS) {
        if (line.includes(marker)) {
          failures.push(`${rel}:${index + 1} carries prose ("${marker}")`);
        }
      }
    }

    const lastStatement = [...lines]
      .reverse()
      .find((line) => line.trim() && !line.trim().startsWith("--"));
    if (lastStatement && !lastStatement.trim().endsWith(";")) {
      failures.push(
        `${rel} ends mid-statement: "${lastStatement.trim().slice(0, 60)}" — prose appended after COMMIT?`
      );
    }
  }
}

if (failures.length) {
  console.error(`FAIL: migrations (${failures.length} problem(s) in ${files} file(s))`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nA migration is applied verbatim by a machine. Move the reasoning into -- comments."
  );
  process.exit(1);
}

console.log(`PASS: ${files} migration file(s) are SQL and terminate correctly`);
