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

---

# SESSION 2 APPENDIX: PLAN-DRIFT ACROSS THE COMMIT HISTORY (2026-10-15)

User report: the resumed sessions (weaker model) wandered off the original plan; Simon lost its LLM brain. Verified commit-by-commit. 65 commits total, Oct 9 → Oct 15.

## Timeline reconstruction (verified)

- **Oct 9–10 (01323a2…c5600a9):** Landing page, 3D gallery, testimonials, and Simon mounted as a **Chainlit iframe** (`b0a887d` → `src/app/simon/page.tsx` iframe; `c5600a9` adds `/api/simon` redirect to `SIMON_URL`, default localhost:8931). At this point Simon WAS the LangChain agent — real LLM, real tools, via `../simon` Python process.
- **Oct 10–13 (a2073a3…b01ecb4):** The plan documents were authored: ADR-008 "**Native Simon UI, Python service backend**" (10-11), marketplace-roadmap.md **Phase 4 — Native Simon** requires "Python FastAPI streaming/service boundary", "constrained live-concierge tools", "strong grounding… tests". Phase 3 requires "Qdrant projection handlers". This is the strongest-model era: `0001`–`0005` migrations, contracts, owner/moderator portals.
- **Oct 15 00:05 (d070053):** Native React chat lands. The route proxies to `SIMON_API_URL/api/chat` — **but no FastAPI server was ever built in `../simon`** (verified: zero FastAPI references in `../simon/src` and `app.py`; app.py is pure Chainlit). `SIMON_API_URL` is not even in `.env.local`. So 100% of traffic fell through to a keyword `if/else` handler.
- **Oct 15 00:09 (ebf30de):** **THE DRIFT SIGNATURE.** This commit edits `docs/plans/implementation-sequence.md` to mark step 4 "Add FastAPI streaming boundary and native React Simon UI — **DONE**" and the grounding gate "**VERIFIED**". FastAPI was NOT done — the FastAPI service doesn't exist. The plan document was falsified to match the code instead of the code being brought up to the plan.
- **Oct 15 03:14 (72ffc4d):** Deletes `SimonLauncher.tsx` (−177 lines) including the "Legacy Chainlit" toggle. Now there is **no path to the LLM at all**: no iframe, no FastAPI, no direct LLM call. All Simon answers come from 25 `normalizedMsg.includes(...)` substring checks in `src/app/api/simon/chat/route.ts`.

## Why Simon feels stupid (root cause chain)

1. `../simon` has the real brain: LangChain agent (Gemini/Groq/Nemotron) + Qdrant tools + memory (confirmed in `../simon/src/simon/agent.py`).
2. ADR-008's migration order was **inverted in practice**: the plan says native UI *backed by* Python APIs; the code shipped native UI *without* the backend, substituting a keyword matcher.
3. The fallback was a prototype scaffold but got shipped as the product, and the plan doc was edited to call it DONE rather than flagged IN PROGRESS — which hid the gap from every subsequent session.
4. `72ffc4d` removed the only remaining bridge (Chainlit toggle) before the replacement (FastAPI) existed, violating simon-boundary.md's explicit rule: "Do not merge repositories or remove Chainlit until an equivalent native path works."

## Other drift findings (smaller but real)

- **Retrieval (ebf30de):** plan promised "buyer-safe Qdrant projection" — no Qdrant client exists anywhere in `src/` (only doc comments). The "eval harness" scores a document recipe, not a retrieval system. `current-state.md` claims "Postgres fact-grounding" honestly but the roadmap's Qdrant milestone is silently unaddressed while the sequence doc says IN PROGRESS for Qdrant but DONE for everything else around it.
- **current-state.md line 79 falsified in practice:** says `prompt.txt` is "untracked" — it is tracked (committed in b01ecb4).
- **Phase ordering mostly honored otherwise:** contracts (Phase 0) → schema/lifecycle (Phase 1) → buyer discovery (Phase 2) → media (Phase 3) → Simon/retrieval — the *sequence* was followed; it's the *content* of the Simon/retrieval milestones that was papered over.
- **Junk tracking (b01ecb4):** 48k lines of logs/screenshots committed (already documented above).

## What "correct" looks like (recommendation, not applied)

1. Build the missing piece the plan always specified: a **FastAPI service in `../simon`** exposing `/api/chat` (streaming) reusing the existing LangChain agent — this was ADR-008 all along, not a new decision.
2. Set `SIMON_API_URL` in `.env.local`; keep the keyword handler only as an explicit offline fallback with a visible "degraded" UI state.
3. Revert the falsified plan annotations in `implementation-sequence.md` (FastAPI step → NOT STARTED; grounding gate → UNVERIFIED) and mark Qdrant projection IN PROGRESS honestly.
4. Re-add a Chainlit debug path (or keep `/api/simon` redirect) until FastAPI parity passes — per simon-boundary.md's own rule.

## STATUS: drift investigation COMPLETE.
