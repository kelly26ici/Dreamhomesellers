# Audit: Commit 0e049aa & Repo Hygiene (main session, 2026-10-15)

## 1. Commit 0e049aa "Mark the duplicate-GoTrueClient advisory fixed..."

**Verdict: the commit itself is CORRECT — no error found.**

- Only edits `docs/architecture/current-state.md` (3+/3-): replaces the open advisory "read model's browser anon client creates a new GoTrueClient per call (memoization cleanup owed)" with a note that the fix landed in commit `da647e8`.
- Cross-checked: `da647e8` ("Memoize the buyer read-model anon client to stop duplicate GoTrueClient instances", 19 minutes earlier) exists and did exactly what the doc now claims.
- Fix quality is high: module-level memoized anon client (`anonClientInstance ??= createClient(...)`) with `persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true` — the last two flags prevent the dead anon client from racing the real @supabase/ssr client for the OAuth callback code and from eager GoTrue init.
- Nitpick (not an error): module-level singletons are process-scoped in Next.js server code — fine since the client is stateless; just know the singleton is per-process, not cluster-global.

## 2. Commit b01ecb4 "added everything so i can trace all readme .mds..." — REPO HYGIENE PROBLEM

This commit added **84 files / 48,012 insertions** of project-unrelated junk, now git-tracked:

- `.playwright-mcp/` browser page snapshots (`.yml`) + screenshots (incl. a 1.5MB PNG)
- `.playwright-mcp/console-*.log` — incl. two ~18,000-line browser console logs
- `logs/simon.log` (308 lines of runtime log)
- `prompt.txt` (18KB task prompt; project's own current-state.md says it should be untracked)
- `properties-grid.png`, `simon-iframe-check.png` (verification screenshots)
- `tsconfig.tsbuildinfo` (build artifact)

**Recommended (not applied — read-only per instruction):**
1. `git rm -r --cached .playwright-mcp logs prompt.txt properties-grid.png simon-iframe-check.png tsconfig.tsbuildinfo`
2. Add `.playwright-mcp/`, `logs/`, `*.tsbuildinfo` to `.gitignore`.
3. Optional: `git filter-repo` to shed ~3MB of logs/screenshots from history — only if repo not yet shared.

## 3. Plan-document compliance

Delegated to a subagent writing to `audit-findings/plans-compliance.md` (in progress).

## STATUS: commit investigation COMPLETE; plans-compliance agent pending.
