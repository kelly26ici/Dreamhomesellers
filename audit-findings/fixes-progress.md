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
