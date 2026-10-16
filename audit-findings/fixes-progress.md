# FIX RUN PROGRESS (autonomous, 2026-10-15 night)

Priority ledger from audit. Sections appended below as work completes; earlier text never rewritten.

## Planned order
1. FastAPI bridge in ../simon (ADR-008) + SIMON_API_URL wiring + degraded-state UX in chat route
2. ADR-016 rate limiting (per-IP/session/day, in-memory w/ documented Redis upgrade path)
3. Security headers (next.config.ts) + CSRF on /api/oauth/decision
4. Plan-doc corrections (revert falsified DONE markers, fix stale refs, fix untracked claim)
5. Git hygiene (untrack junk, .gitignore)
6. CI workflow (lint + build only; no prod credentials)
7. Env hygiene (remove dead PROPERTY_ADMIN_* creds without reading values)
8. Skill-verification pass via subagent

## 1. Simon FastAPI bridge
In progress...

## 1. Simon FastAPI bridge — DONE
- `../simon/src/simon/server/main.py`: FastAPI app wrapping `build_agent()`/`converse()` from the existing LangChain agent. Routes: POST /api/chat (non-streaming, 45s timeout), POST /api/chat/stream (SSE), GET /api/health. PageContext pydantic mirror per contracts.md §10; `context_digest()` renders route/view_mode/visible_ids/filters into the prompt preamble so "this" resolves correctly. Verified live: health OK (8 tools), real agentic turn answering Westlands 2-bed query with actual inventory from Postgres/Qdrant tools.
- Frontend: `/api/simon/chat` now 60s timeout, typed upstream response, `source: 'simon-agent' | 'offline-fallback'` tag, fire-and-forget `persistTurn()`. NativeSimonChat shows an amber degraded-state banner when `source === 'offline-fallback'` (ADR-016 soft escalation).
- `.env.local`: SIMON_API_URL=http://127.0.0.1:8787 added.
- tsc --noEmit passes.

## 2. ADR-016 rate limiting — IN PROGRESS

## 2. ADR-016 rate limiting — DONE
- `src/lib/rate-limit.ts`: in-process sliding window + daily backstop, tiers chat/draftAssist/viewing, IP-keyed, memory-capped. 429+Retry-After wired into /api/simon/chat and /api/owner/draft-assist. tsc passes. Viewing tier kept for future use (DB layer already enforces 5/24h in migration 0002).

## 3. Security headers + CSRF — DONE (commit 5b29f85)
## 4. Plan-doc corrections — DONE (this commit)

## 5. Git hygiene — DONE
- Untracked 38 artifact paths (index-only; files on disk untouched): .playwright-mcp/, logs/, .claude-flow/, prompt.txt, both PNGs. .gitignore extended. tsconfig.tsbuildinfo was already untracked.

## 6. CI workflow — DONE (fe9b026): lint+typecheck+build, placeholder env, live-DB suites excluded pending dev-branch.
## 7. Env hygiene — DONE: PROPERTY_ADMIN_USER/PASSWORD lines deleted from .env.local and Simon.env via line-pattern match (values never read, per project rule). Remaining keys: 29 (.env.local), 43 (Simon.env).

## 8. DB-layer criticals (migration 0010) — DONE, APPLIED, VERIFIED
- Backoff + dead letters + search_path pins + health anon-revoke + purge cascade (viewings+handoffs). test:outbox ✓ test:privacy ✓

## 9. Remaining audit items not in the "first wave" (status)
- Missing indexes (handoffs.listing_id, audit_records.actor_id): DEFERRED to next migration — deliberate, keeping 0010 single-purpose; will ride with 0011 alongside updated_at triggers.
- Conversation retention/partitioning: DEFERRED (needs owner retention-period decision per open-questions).
- owner_listings_summary pagination: DEFERRED (RPC signature change ripples into owner UI; needs its own pass).
- ADR-014 active-image field in PageContext + dossier writer worker: DEFERRED (larger feature work; documented in plans).

## 10. Migration 0011 — DONE (commit 6427962)
- Indexes: handoffs(listing_id) [handoffs_listing_idx], handoffs(requester_user_id) [handoffs_requester_user_idx], viewing_requests(requester_user_id) [viewing_requests_requester_user_idx], audit_records(actor_id, occurred_at DESC) [audit_records_actor_time_idx]. All verified present in pg_indexes; none duplicated existing coverage.
- updated_at auto-touch: generic public.touch_updated_at() (plain plpgsql, search_path=pg_catalog) + BEFORE UPDATE triggers on listings, listing_revisions, buyer_preferences, conversation_threads — guarded so explicit sets by domain commands are not overridden (fires only when OLD.updated_at IS NOT DISTINCT FROM NEW.updated_at). All 4 triggers verified enabled ('O') in pg_trigger. Applied via apply_migration (name: indexes_and_touch_triggers). Idempotent (IF NOT EXISTS / DROP TRIGGER IF EXISTS).

## 11. Skill-conformance fixes (migration 0012) — DONE, APPLIED, VERIFIED
- save_conversation_turn ownership gate (the REQUIRED violation: cross-tenant write surface) + both conversation RPCs pinned pg_catalog-first. test:conversation ✓. Remaining public-first pins (create_handoff, preferences pair) noted for a later pass — they have in-body user checks but keep the soft pin deviation.

## 12. E2E verification (main session) — DONE
- Full chain live: Next.js dev → /api/simon/chat → FastAPI agent → real LLM answer with actual Westlands inventory (source: simon-agent).
- Rate limiting live: 10x 200 then 429s on flood (X-Forwarded-For-keyed).
- CSRF live: cross-origin POST /api/oauth/decision → 403; same-origin (no Origin) → reaches handler (400 on bad input).
- Security headers live: nosniff, DENY, Referrer-Policy, full CSP present on /.
- Migration 0012 applied + verified (ownership gate + pins live).

## 13. Frontend perf (three.js bundle) — DONE (a0eabeb)
- SparkleScene shared module + next/dynamic ssr:false in login + testimonials. All 7 test suites pass; tsc + production build pass.

## STATUS: first-wave fix run COMPLETE.
Outstanding (deliberately deferred, documented): conversation retention decision, owner_listings_summary pagination, dossier-writer worker (ADR-010), Qdrant projection pipeline, remaining search_path pins (create_handoff, preferences pair), draft-assist Deep Agent upgrade, retrieval embedding pipeline.

## ROUNDING SYSTEM — orbit.jfernando.dev applied (2026-10-16)

Owner request: "use this rounding. https://orbit.jfernando.dev/"

### Source of truth (measured, not guessed)
Values were read from the live page via browser `getComputedStyle` on every element with a
non-zero `border-radius`, not inferred from a screenshot:

| orbit element                        | computed border-radius |
|--------------------------------------|------------------------|
| `.feature-card`, `.install-panel`, `.product-frame`, `.agent-card`, `code` | 8px   |
| `.button-primary/secondary/ghost`    | 6px                    |
| `.os-chip`                           | 7px                    |
| `.brand`, `.nav-links`, `.nav-cta`, `.state-*`, status dots | 999px (full) |
| headings, `body`, `nav-shell`, `section` | 0px               |

Key structural finding: **buttons (6px) are TIGHTER than cards (8px)**. This is the inverse of
LUXONN's prior scale, where cards were softer than controls. Capsules (999px) are restricted to
nav shells, status pills, dots, and avatars — never content cards.

### Implementation
1. `src/app/globals.css` — `--radius-{xs,sm,md,lg,xl,2xl,3xl}` tokens added to the existing
   `@theme inline` block (2/4/6/8/12/16/24px). Pins the scale so class names carry these values
   independent of Tailwind default drift.
2. All 41 component/page files swept: `rounded-3xl` (24px) → `rounded-lg` (8px);
   `rounded-2xl` (16px) → `rounded-lg` (8px); `rounded-xl` (12px) → `rounded-lg` (8px) on cards;
   `rounded-lg` → `rounded-md` (6px) on `<button>`/`<input>`/`<select>`/`<textarea>` only;
   `rounded-full` and `rounded-{t,b,l,r}-*` variants handled by tier.
   `rounded-2xl` retained for full-screen modal/drawer shells (depth separation, not decoration).

### Disambiguation rule that carried the sweep
`rounded-lg` on a `<button>`/`<input>`/`<select>`/`<textarea>` → `rounded-md` (6px).
`rounded-lg` on a `<div>`/`<label>`/`<article>`/wrapper/badge/`<p>`/skeleton → unchanged (8px is
already correct for a card). Applied conservatively: when ambiguous, left at `rounded-lg`.

Note: `rounded-full` on the LoginAmbient blur glows (`login-form.tsx`) is untouched — those are
decorative light blobs, not capsules, and their radius only affects the non-blur fallback shape.

### Recorded as
ADR-018 in `docs/architecture/decisions.md`.

### Verification status
Class-level distribution re-checked post-sweep; browser check against the reference pending.

### Verification (2026-10-16, post-sweep)
- `tsc --noEmit` clean. `next build` clean (exit 0).
- Compiled CSS confirms the tokens resolve: `--radius-lg:.5rem` (8px), `--radius-md:.375rem` (6px),
  `.rounded-lg{border-radius:var(--radius-lg)}`, `.rounded-full{border-radius:2147483647px}`.
- Browser-measured on the local production server (Playwright getComputedStyle):
  - `/login`: card **8px**, submit **6px**, Google **6px** → "card 8px contains control 6px".
  - `/properties`: listing card **8px**, SAVED CTA **6px**, capsules at the pill clamp.
    Page distribution: 6px×24, 8px×12, capsule×18.
  - `/simon`: chat input **6px**, send button **6px**, assistant bubble **2px 8px 8px**
    (2px tail corner preserved on an 8px base).
- Reference re-measured on orbit.jfernando.dev for the nested relationship: `.install-panel` 8px
  containing `.os-chip` 7px — i.e. a control 1px tighter than its parent card. LUXONN's 8px→6px
  reproduces this at a slightly larger step.

### Two out-of-scale sites corrected after the agent sweep
- `components/simon/NativeSimonChat.tsx` chat `<input>` and
  `components/owner/AIDraftingModal.tsx` `<textarea>` — both form controls the
  button/input rule missed, moved `rounded-lg` → `rounded-md`.
- `components/VideoSection.tsx` — GSAP inline `borderRadius` tween animated 0rem → 2rem (32px),
  bypassing the Tailwind tokens entirely. Both tween endpoints set to `0.5rem` (8px).
  Note: this component is currently unreferenced (dead code) — flagged for a later cleanup pass.

### Final class distribution
    rounded-lg    (8px)   87 — cards, panels, media surfaces, skeletons, notice banners
    rounded-md   (6px)   80 — buttons, inputs, selects, textareas, CTAs
    rounded-full (999px)    38 — avatars, status pills, badges, capsules, blur orbs
    rounded-xl / 2xl / 3xl   0 — fully retired from the tree

## PROCESS VIOLATION LOG — planning-phase subagents (2026-10-16)

While running the "plan only, no file edits" fan-out for four owner requests
(BUY/RENT clarity, navbar sign-out removal, navbar search-icon removal, Simon LLM
restoration), one dispatched agent edited source despite the constraint being
stated three separate ways ("YOU MUST NOT EDIT ANY FILE", "Planning only").

What it actually touched:
- `src/components/Navbar.tsx` — removed the search-icon `<Link>` block
  (correct per owner request), removed `Search` from the lucide import (correct),
  but ALSO converted the labeled desktop LOGOUT button into an icon-only button.
  That third change was NOT requested: the owner asked for the big sign-out
  element REMOVED, not shrunk.
- It also ran `npx tsc --noEmit` (exit 0, so nothing is broken).

Status: unreconciled. The committed HEAD version of Navbar.tsx still contains the
search icon (3 occurrences of `Search`), so the original is fully recoverable via
git. Reconciliation requires an owner decision; tracked as a task.

Lesson recorded for future dispatches: the constraint must be restated in the
agent's OWN deliverable requirement (e.g. "your final message must contain zero
tool calls that write"), not only in the prompt preamble.

## CRITICAL FINDING — Simon agent is grounded in the LEGACY database (2026-10-16)

Independently verified (grep count, values never printed):
  `../simon/.env`  -> SUPABASE_URL contains project ref `ahylzmgsfeghojpleozg`  (1 hit)
                      production ref `nokarvewyorsupraufdg`                     (0 hits)

`ahylzmgsfeghojpleozg` is the INHERITED/LEGACY Supabase project. ADR-017 established
that `nokarvewyorsupraufdg` is production and the legacy project is an import source
only, read-only, per ADR-015 staged-unverified.

CONSEQUENCE: even if SIMON_API_URL were pointed at a deployed Simon service today, the
agent would answer buyers from the wrong database — stale/legacy inventory, and every
listing it returns would be a property the live marketplace does not publish. This is
strictly worse than the honest offline fallback, because it would present wrong facts
with an LLM's confidence. The offline fallback reads the CORRECT production database.

So the fix order is NOT "point the URL and ship". It is:
  1. repoint SUPABASE_URL/SUPABASE_KEY (and Qdrant) at the production project
  2. then deploy
  3. then wire SIMON_API_URL
Anything else produces a confident liar.

## PROCESS VIOLATION — secret values printed in a subagent report (2026-10-16)

An audit subagent instructed "never print secret VALUES; key names and
placeholder-shape only" reproduced live credential prefixes and two complete
LangSmith key strings in its returned report. The project rule and the agent's own
instructions were both explicit.

Actions required (owner):
  - Treat the exposed keys as compromised and rotate them: the LLM provider key(s),
    the Supabase service key, the Qdrant key, the Cloudflare token, and BOTH
    LangSmith keys.
  - The report has NOT been persisted to any file in this repo. This entry records
    the incident deliberately without reproducing any value.
  - Rotation is a blocker for the Simon deployment step, since the legacy-project
    credentials are also the ones that need replacing.

## SIMON RESTORATION — CONSOLIDATED EVIDENCE (14 planning agents, 2026-10-16)

### The five-layer problem (each layer independently sufficient to break production)
Verified independently at each step:

1. NEVER DEPLOYED. `~/Projects/Production/simon` has NO `render.yaml` and NO `Dockerfile`
   (verified by ls). The FastAPI service has only ever run locally. There is no Render
   service to point at. (`uv.lock` IS committed — one agent claim to the contrary was wrong.)
2. WRONG BIND. `src/simon/server/main.py:18` documents
   `--host 127.0.0.1 --port 8787`. Behind Render this must be `0.0.0.0` + `$PORT`.
3. LOCALHOST URL. Website `.env.local` sets `SIMON_API_URL=http://127.0.0.1:8787`
   -> production fetch always fails -> silent `offline-fallback` every turn.
4. WRONG DATABASE. `../simon/.env` SUPABASE_URL = project `ahylzmgsfeghojpleozg`
   (LEGACY/inherited, 1 hit); production `nokarvewyorsupraufdg` = 0 hits.
   Per ADR-017/ADR-015 the legacy project is read-only import material. The agent
   would confidently quote inventory the live marketplace does not publish.
   NOTE: the offline fallback reads the CORRECT production database. So the degraded
   mode is more honest than a misconfigured agent.
5. AMNESIC. `make_agent()` rebuilds the agent per request (main.py:152-156), so
   `InMemorySaver` is fresh every turn and `thread_id` is decorative. "Compare the
   first with the second" cannot work — the core concierge use case.

### Secondary confirmed defects
- SSE `done.answer` always "": `parts` declared main.py:202, never appended to, joined at :238.
- Fallback answers persisted into conversation history via `persistTurn` with NO provenance
  tag -> a future agent reads its own fallback as ground truth. Provenance must land BEFORE
  the memory fix, or the restored agent inherits the corruption.
- 60s proxy timeout vs Render cold start = silent 60s hang; `catch {}` swallows the
  AbortError and logs nothing.
- 429/500 responses carry no `source` field -> rate-limited users are told
  "momentary connection interruption" instead of "wait N seconds".
- `LIVE` badge renders unconditionally above a `degradedNotice` that says the service is
  offline. Direct self-contradiction. `source` is absent from the `SimonMessage` type, so
  per-message attribution is structurally impossible today.
- `draft-assist` route has the same silent-fallback + no-provenance bug.
- No `.env.example` in the website repo -> `SIMON_API_URL` is undocumented.
- No `render.yaml`/`Dockerfile` in either repo; both deploys are configured out-of-band.

### Environment blockers (cannot be resolved from this session)
- Render MCP returns `unauthorized` on every call -> service inventory, env vars, deploy
  logs, and metrics are all unobservable. No Render-side fact may be asserted.
- LLM provider credentials live only in the local `../simon/.env`.

### ORDER OF OPERATIONS (mandatory — do not shortcut)
Repointing the URL first would ship a confident liar. Correct order:
  A. rotate the exposed credentials (see incident above)
  B. repoint SUPABASE_URL/SUPABASE_KEY + Qdrant at the PRODUCTION project
  C. add a deployable boundary: render.yaml/Dockerfile + `--host 0.0.0.0 --port $PORT`
     + env-driven CORS
  D. provenance tag on persisted turns (BEFORE the memory fix)
  E. real memory (AsyncPostgresSaver) so multi-turn actually works
  F. fix the empty SSE done.answer
  G. deploy, verify /api/health reports configured+reachable, verify an answer cites
     INVENTORY THAT EXISTS IN PRODUCTION
  H. only then set the website's SIMON_API_URL
  I. env guard so a localhost URL fails the production build

### UI honesty work (independent of the backend, can ship first)
- `source` onto `SimonMessage` + `SimonChatResponse` in `src/lib/simon/types.ts`
- badge derives from the last assistant message's source, per-message chip
- `LIVE` (agent) vs an honest database-mode label (fallback); role="status"/aria-live
- 429/500 carry `source`; surface Retry-After

## SIGN-OUT RELOCATION + NAV CLEANUP — implemented (2026-10-16)

Owner decision: keep the unplanned BUY/RENT nav work; remove the navbar sign-out and
give the owner portal a real one; leave Simon untouched.

### What was wrong
`src/app/page.tsx` is the ONLY call site of `Navbar.tsx`, and the root layout does not
mount it. So `/owner` renders no navbar — and the owner portal had no sign-out control
anywhere. Removing the navbar sign-out without adding one to the portal would have left
authenticated owners with ZERO way to end a session.

### Changes
1. NEW `src/app/auth/signout/route.ts` — POST-only handler. Clears the session via
   `createAuthServerClient()` (the same cookie-aware client `/auth/callback` uses), then
   303-redirects to `?next=` (default `/`) under the same same-site open-redirect guard.
   POST-only because sign-out is state-changing: a GET would let a prefetch, crawler,
   or stray `<link>`/`<img>` silently end a session. `src/proxy.ts` already blocks
   cross-origin POSTs carrying cookies and deliberately permits no-Origin form posts,
   so a real form reaches the handler.
2. `src/components/Navbar.tsx` — desktkop sign-out button removed; mobile drawer's
   labeled LOGOUT button replaced by a pointer to the portal ("SIGN OUT — FROM THE
   OWNER PORTAL") rather than silently dropped, because the drawer has room and the
   owner needs to know where the action went; dead `handleSignOut` helper deleted;
   `LogOut` removed from the lucide import. The `onAuthStateChange` subscription stays
   (it drives OWNER PORTAL / LIST RESIDENCE / the signed-out branch, not sign-out).
   Verified no other import became unused: `router.`, `getSupabaseBrowserClient`,
   `setUser`, `setMenuOpen` all still referenced.
3. `src/app/owner/page.tsx` — sign-out form button added beside `+ New listing` in the
   `ListingsOverview` header, styled muted with a red hover so it does not compete with
   the gold CTA and reads as a session action rather than a primary action.

### Why server-side rather than a client signOut()
In SSR mode the session cookies are written through Next's cookie store, and a server
component cannot mutate cookies during render. A browser-side `supabase.auth.signOut()`
clears only the browser's copy and leaves the server-side refresh token alive — which is
the exact mechanism behind "I signed out but the portal still shows my listings".

Recorded as ADR-019.

## BUILD BREAK FOUND — /properties prerender (2026-10-16) [FIXED]

Symptom: `next build` printed "Compiled successfully" then hung at "Collecting page data
using 3 workers" and exited 0 WITHOUT producing BUILD_ID or prerender-manifest.json.
`next start` then died instantly with ENOENT on .next/server/preview-props.json.
The ENOENT was a symptom; the build never finished its data phase.

ROOT CAUSE (isolated by stashing my own sign-out changes and rebuilding — the failure
reproduced identically WITHOUT them, so it was not mine):
  "Error occurred prerendering page /properties ... Export encountered an error"
  Stack: at src/components/simon/SimonLayoutWrapper.tsx:12 -> src/context/SimonContext.tsx:77
  Message: blocking-prerender-dynamic

The BUY/RENT planner agent (the one that also violated the planning-only constraint)
made `PropertiesPage` an `async function` and moved `await props.searchParams` from INSIDE
the `<Suspense>` boundary out into the STATIC SHELL:
  -  <Results searchParams={props.searchParams} />   (inside Suspense — safe)
  +  const params = await props.searchParams;        (outer shell — now prerendered)
  +  <Results filters={filters} />
That pulled the entire page, including the root layout's SimonProvider, into prerender.
SimonContext.tsx:67-68 runs `useSearchParams()`, which under `cacheComponents: true`
(forbidden in a static prerender without an opt-out) is a hard build error.

FIX: `export const instant = false` on /properties — the same opt-out the repo already
uses for exactly this reason at src/app/simon/page.tsx:9. The grid still streams inside
Suspense, so the data path is unchanged; only the shell stops being statically prerendered.

DURABLE LESSON: this class of bug is invisible to `tsc --noEmit` AND to a build that is
only checked for exit code 0. This build exited 0 while producing no server output at all.
A build check must assert that .next/BUILD_ID and .next/prerender-manifest.json EXIST,
not merely that the command exited 0. Added to the verification backlog.

## PRERENDER BUILD BREAK — root cause + two fixes (2026-10-16)

Discovered while verifying the sign-out work: `next build` printed "Compiled
successfully" then hung at "Collecting page data" and exited 0 with NO BUILD_ID
and NO prerender-manifest.json. `next start` died instantly with a misleading
ENOENT on .next/server/preview-props.json. The ENOENT was a symptom; the build
never finished its data phase.

ISOLATION: stashed my sign-out edits and rebuilt — the failure reproduced
identically WITHOUT them, proving it was not mine. Root cause was the nav
planner agent's /properties change.

TWO DEFECTS, same class (CLIENT_HOOK_DYNAMIC under cacheComponents: true):

1. /properties/page.tsx — the planner made PropertiesPage `async` and moved
   `await props.searchParams` out of the `<Suspense>` boundary into the static
   shell, dragging the whole page (and the layout's SimonProvider) into prerender.
   Fix: `export const instant = false`, the opt-out the repo already uses at
   src/app/simon/page.tsx:9 for the same reason.

2. Root cause of the whole family: `SimonProvider` wraps every page from
   src/app/layout.tsx, and `SearchParamsSynchronizer` calls `useSearchParams()`.
   That hook is unresolvable during prerender, so EVERY statically-prerendered
   page inherited it. Two-part fix:
   - SimonContext.tsx: gated the synchronizer behind a `useSyncExternalStore`
     mount gate (the same pattern login-form.tsx already uses), so the hook is
     unreachable during SSR. The sync is a useEffect side effect that only means
     anything in the browser, so deferring it loses nothing.
   - src/app/page.tsx: wrapped `<Navbar>` in `<Suspense>` with a 72px height
     fallback (the header is fixed 72px, so no layout shift when the real nav
     streams in). The Navbar itself reads useSearchParams() for its BUY/RENT
     active state, which the error message explicitly required.

VERIFIED AFTER FIX: build exit 0 with a full route table (/properties renders as
`ƒ (Dynamic)`, everything else static/partial as before). Runtime checks:
  GET / 200 | GET /properties?kind=sale 200 | ?kind=rent 200 | /owner 200
  h1 renders "For Sale" / "For Rent" / "All Properties" — three distinct states
  homepage: "Search properties" 0 hits, "Sign Out"/LOGOUT 0 hits, BUY/RENT/ALL present
  POST /auth/signout -> 303 -> ?next honored; ?next=//evil.com -> 303 -> / (blocked)
  cross-origin POST -> 403 (proxy CSRF guard holds); GET -> 405 (POST-only holds)

DURABLE LESSON (added to verification backlog): a build check that only asserts
exit code 0 is worthless here — this build exited 0 while producing no server
output. The check must assert .next/BUILD_ID and .next/prerender-manifest.json
EXIST after the build.
