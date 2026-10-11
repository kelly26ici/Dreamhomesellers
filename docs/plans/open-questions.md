# Open questions

Decisions the owner must still make. Each item names the stakes, the options, and a recommendation, but none is settled until answered here. When a question is resolved, move it to [the decision log](../architecture/decisions.md) with its rationale and retire it from this list.

**Retired 2026-10-11:** Q1 → ADR-012, Q2 → ADR-013, Q3 → ADR-014, Q4+Q5 → ADR-016 (accepted as working default, owner may revise), Q8 → ADR-015. All are recorded in the [decision log](../architecture/decisions.md). Remaining questions keep their original numbers.

## 6. Deployment topology

**Question:** Where do the Next.js app, the Python service, background workers, Qdrant, and the database run in production?

**Stakes:** The current free-tier provider set (Cloudflare, NVIDIA, Groq, Gemini) constrains where media processing and embedding jobs can run. Qdrant Cloud free tier has one small cluster; Supabase is fixed as Postgres.

**Recommendation:** Defer until Phase 3/4 media and agent work is designed; the topology must follow the workload, not precede it. Document the chosen topology as an ADR when decided.

## 7. Operational configuration still needed

**Question:** Which of these will the owner provide?

- `SUPABASE_DB_PASSWORD` — enables direct async Postgres access for the Simon service (currently the service uses Supabase REST only)
- `LANGSMITH_API_KEY` — enables LangSmith tracing (wired, dormant without the key)
- `TAVILY_API_KEY` — enables web search as an agent tool (design already accounts for it)
- A valid `GEMINI_API_KEY` — the current key was tested live and returns `ACCESS_TOKEN_TYPE_UNSUPPORTED`; NVIDIA remains the working primary, but the Gemini fallback is currently dead

**Stakes:** Direct Postgres unlocks transaction-safe listing operations and a Postgres-backed LangGraph checkpointer; LangSmith is the observability backbone; Tavily is the grounded web-search tool; the dead Gemini key removes one of four model fallbacks.

**Recommendation:** Provide all four when convenient. The Gemini key matters most for fallback resilience; the DB password matters most for the Phase 1 listing lifecycle.
