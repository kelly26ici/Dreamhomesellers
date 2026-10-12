# Open questions

Decisions the owner must still make. Each item names the stakes, the options, and a recommendation, but none is settled until answered here. When a question is resolved, move it to [the decision log](../architecture/decisions.md) with its rationale and retire it from this list.

**Retired 2026-10-11:** Q1 → ADR-012, Q2 → ADR-013, Q3 → ADR-014, Q4+Q5 → ADR-016 (accepted as working default, owner may revise), Q8 → ADR-015. All are recorded in the [decision log](../architecture/decisions.md). Remaining questions keep their original numbers.

## 6. Deployment topology

**Question:** Where do the Next.js app, the Python service, background workers, Qdrant, and the database run in production?

**Stakes:** The current free-tier provider set (Cloudflare, NVIDIA, Groq, Gemini) constrains where media processing and embedding jobs can run. Qdrant Cloud free tier has one small cluster; Supabase is fixed as Postgres.

**Recommendation:** Defer until Phase 3/4 media and agent work is designed; the topology must follow the workload, not precede it. Document the chosen topology as an ADR when decided.

## 7. Operational configuration still needed

**Question:** Which of these will the owner provide?

- `SUPABASE_DB_PASSWORD` — enables direct async Postgres access for the Simon service (currently the service uses Supabase REST only). **Password candidates were provided 2026-10-12, but a probe found the project's database endpoints are IPv6-only (direct `db.*` host has no A record; no Supavisor pooler A record exists in any probed region) while the current network is IPv4-only — so no direct Postgres connection is possible from this machine regardless of password. All database work must go through the dashboard SQL editor (HTTPS) until the network or an IPv4 endpoint (e.g. a pooler created later) changes.**
- `LANGSMITH_API_KEY` — **provided 2026-10-12 and wired into `simon/.env` + `Simon.env` (tracing activates on Simon restart), but the key is rejected server-side (403 on all LangSmith API endpoints via CLI auth). Needs rotation or workspace-scope fix in the LangSmith console.**
- `TAVILY_API_KEY` — **not present in `Simon.env` (checked by name only, 2026-10-12); the key the owner mentioned was not found there. Still needed.**
- A valid `GEMINI_API_KEY` — the current key was tested live and returns `ACCESS_TOKEN_TYPE_UNSUPPORTED`; NVIDIA remains the working primary, but the Gemini fallback is currently dead. **Name present in `Simon.env`; validity unchanged.**

**Stakes:** Direct Postgres unlocks transaction-safe listing operations and a Postgres-backed LangGraph checkpointer; LangSmith is the observability backbone; Tavily is the grounded web-search tool; the dead Gemini key removes one of four model fallbacks.

**Recommendation:** Provide all four when convenient. The Gemini key matters most for fallback resilience; the DB password matters most for the Phase 1 listing lifecycle.

## 9. Unknown external writer of the non-marketplace tables

**Question:** What is the component outside the simon repository that writes `conversation_messages`, `customer_profiles`, `property_submissions`, `request_outbox`, `mpesa_transactions`, and `schema_migrations` — and must it keep running during the migration?

**Stakes:** The [discovery brief](schema-discovery-brief.md) (sections 2 and 7) found six relations carrying rows that nothing in the audited source writes, so some other deployed service holds write credentials to the legacy database. Its identity, hosting, and credential scope are unknown — meaning the real set of credential holders is unknown.

**Status update 2026-10-12 (ADR-017):** LUXONN's marketplace database is now the fresh, verified-empty project `nokarvewyorsupraufdg` in the dream-home-sellers organization. The unknown writer lives in the *legacy* project and can no longer affect marketplace schema decisions; it now constrains only (a) reads from the legacy project during the audited import, and (b) whether the legacy service keeps running after import. Identification remains recommended (brief verification backlog item 16) but is no longer a migration blocker.

**Recommendation:** Identify it from owner knowledge or Supabase logs (brief, verification backlog item 16) before the legacy project is paused or deleted. Until then, keep every legacy table untouched, per [ADR-015](../architecture/decisions.md).
