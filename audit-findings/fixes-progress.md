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
