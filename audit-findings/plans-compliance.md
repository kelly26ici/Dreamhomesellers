# Plan-document compliance audit (2026-10-15)

## In progress...
## Scope and method

Audited on 2026-10-15, read-only, against:
- Plan docs: `docs/plans/{marketplace-roadmap,implementation-sequence,phase1-migration-runbook,schema-discovery-brief,open-questions}.md`
- Architecture docs: `docs/architecture/{marketplace-target,decisions,current-state,security-data-boundaries,contracts}.md`
- Code: `supabase/migrations/` (9 files), `supabase/seeds/` (2 files), `src/app/`, `src/lib/`, `src/components/`, `scripts/` (7 test/eval scripts), `package.json`, git history (65 commits).
- Verification method: every "DONE" claim in the plans was cross-checked against the actual migration SQL, route files, lib modules, scripts, and package.json script entries. Runtime results (test pass/fail) could not be re-executed in this audit; presence and shape of the claimed artifacts is what was verified.

---

## 1. docs/plans/marketplace-roadmap.md — verdict: PARTIALLY FOLLOWED (Phases 0-2 substantially followed; Phases 3-5 partial)

### What it planned
Six phases (0-5) with deliverables and exit criteria, plus cross-phase standards.

### What the code shows

**Phase 0 (Contracts and product foundation) — FOLLOWED.**
- TS domain contracts exist at `src/lib/contracts/` (shared.ts, property.ts, listing.ts, listing-revision.ts, listing-media.ts, owner-facing organization.ts, moderation.ts, viewing-request.ts, handoff.ts, page-context.ts) — committed as `8961619 "Add Phase 0 domain contracts"`.
- Contract-of-record document `docs/architecture/contracts.md` (57KB) includes the Python pydantic mirrors and the full inherited-column disposition, as the roadmap required.
- Public/restricted field classification: implemented via the `FieldClass` union in `src/lib/contracts/shared.ts` and the restricted-field gate in `src/lib/retrieval/document-recipe.ts` (`RESTRICTED_FORBIDDEN_FIELDS`, recipe `v1_buyer_safe_kenya`).
- Retrieval evaluation dataset: `src/lib/retrieval/eval-dataset.ts` defines the labeled Kenya queries.
- Hardcoded homepage card objects: replaced — `src/app/page.tsx:44` reads `fetchPublishedFeatured(3)` from Postgres; git `194c24a "Replace hardcoded international homepage content with the live published Kenyan record"`.

**Phase 1 (Authenticated owner + moderated lifecycle) — FOLLOWED.**
- Migrations 0001 (tenancy/lifecycle, 18 tables), 0003 (owner domain commands), 0005 (moderation), 0006 (media storage), 0008 (outbox worker) all exist and contain the functions the docs claim (`create_solo_organization`, `create_listing_draft`, `update_draft_revision`, `submit_revision_for_review`, `withdraw_listing` in 0003; `decide_moderation_case`, `bootstrap_first_admin`, `moderator_cases_summary/detail` in 0005; buckets `listing-originals`/`listing-derivatives` with 25MB limit at 0006:21).
- Owner routes `/owner`, `/owner/listings/new`, `/owner/listings/[listingId]`, `/owner/listings/[listingId]/edit` exist; moderator routes `/moderator`, `/moderator/cases/[caseId]` exist.
- Auth: `/login` page and `src/proxy.ts` session refresh exist as documented.

**Phase 2 (Buyer discovery) — FOLLOWED.**
- Read model `src/lib/marketplace/read-model.ts`; `/properties` grid with `FilterBar.tsx`, `ListingCard.tsx`; `/property/[listingId]` detail page.
- Save/compare: `src/lib/marketplace/saved-listings.ts` (localStorage store) + `/saved` page with compare table.
- Similar: `SimilarResidencesStrip.tsx`; viewing: `ViewingRequestForm.tsx` + migration 0002 `create_viewing_request` (verified-contact flow per ADR-016, 0002:114-122).
- Gallery relocation: `/gallery` page feeds `CircularGallery` from `fetchPublishedFeatured(8)` (ADR-007 honored — not used as primary search).
- Legacy import: `supabase/seeds/0002_legacy_import_curated.sql` (20 curated rows), commit `adcf16a`.

**Phase 3 (Media intelligence + retrieval quality) — PARTIALLY FOLLOWED.**
- Present: direct client-side upload with SHA-256 hashing (`src/lib/media/upload.ts`), buckets + storage RLS (0006), media domain RPCs, tables `media_observations`/`visual_dossiers` (0001), retrieval eval harness (`scripts/run-retrieval-eval.mjs`).
- Absent: EXIF/privacy treatment (grep finds "EXIF" only in a contract comment, `src/lib/contracts/listing-media.ts:13`), file scanning, structured captioning pipeline, Qdrant projection handlers (only a comment "Qdrant semantic projection (Phase 4) will refine this later", `src/lib/marketplace/read-model.ts:573`), reconciliation jobs for media/index drift, resumable upload (only direct upload).
- The implementation-sequence doc honestly marks step 3.3 "IN PROGRESS" and 3.4 "worker pipeline staged" — consistent with the code.

**Phase 4 (Native Simon) — MOSTLY FOLLOWED, with gaps.**
- Native React chat: `NativeSimonChat.tsx`, `SimonDockedSidebar.tsx`, `SimonLayoutWrapper.tsx`, `src/context/SimonContext.tsx`, `/simon` route — zero iframes confirmed (only comment-level mentions).
- Chat API `/api/simon/chat` grounds facts through `fetchPublishedListing`/`fetchPublishedGrid` (route.ts:60,140,167).
- Typed page context: `src/lib/contracts/page-context.ts` + `AskSimonButton.tsx`.
- Conversation persistence + handoffs: migration 0007 (`conversation_threads`, `conversation_messages`, `save_conversation_turn`, `get_conversation_history`, `create_handoff`).
- Consent capture: `/oauth/consent` page + `/api/oauth/decision` exist.
- Gap: ADR-016's server-side rate limits and soft-escalation for anonymous chat/viewing are NOT implemented anywhere (`grep -rn "429" src/app/api` returns nothing; no rate-limit module exists). This is a roadmap/security-doc requirement not yet in code, and no plan doc flags it as open.
- Gap: the "FastAPI streaming boundary" is only a conditional pass-through (`process.env.SIMON_API_URL` fetch fallback in the chat route); the Python service remains the separate `../simon` repo, matching ADR-008's transitional state but not a delivered streaming boundary.

**Phase 5 (Long-horizon workflows) — PARTIALLY FOLLOWED.**
- Owner draft assistance: delivered, but NOT as the planned "Deep Agent or LangGraph workflow" — it is a Next.js route `src/app/api/owner/draft-assist/route.ts` with a local `synthesizeLuxuryDraft` function and optional Simon proxying. Deviation from the roadmap's letter; functionally in place.
- Preferences/consent memory: migration 0009 (`buyer_preferences`, RLS, upsert/get RPCs).
- Outbox consumers: `/api/internal/outbox` dispatches by event type behind an `OUTBOX_CONSUMER_SECRET` header (route.ts:21-25) — but no actual CRM/calendar/notification integrations exist yet; the roadmap deliverable "CRM/calendar/notification integrations through the outbox" is only plumbing.
- Observability: only `/api/health` + `get_platform_operational_health` (0009:185); no dashboards, agent/retrieval eval loops beyond the one-off retrieval eval, or abuse controls.
- Privacy retention/deletion: `purge_buyer_personal_data` right-to-be-forgotten cascade implemented (0009:140).
- Internal/buyer research workflows (roadmap deliverable): not implemented; the implementation-sequence correctly leaves step 6.2 without a DONE marker.

### Verdict
**PARTIALLY FOLLOWED.** Phases 0, 1, 2 are faithfully delivered (and the implementation sequence gates were honored in order — contracts commit `a313b4f`/`8961619` precede the schema migration commit). Phases 3-5 are partially delivered; the most material deviations are the absent EXIF/captioning/Qdrant pipeline (Phase 3), the absent ADR-016 rate limiting (Phase 4/security doc), and the draft-assist being a heuristic Next.js route rather than the planned Deep Agent/LangGraph workflow (Phase 5).


---

## 2. docs/plans/implementation-sequence.md — verdict: FOLLOWED (with self-declared deviations, one unverified claim)

### What it planned
Six numbered build steps with decision gates, the first task being the schema discovery brief, and per-step DONE markers with dates.

### What the code shows
- Step 1 (freeze contracts before persistence): done before migrations — commit order is `a2073a3` (discovery brief) and `8961619` (Phase 0 contracts) before `a313b4f` (Phase 1 schema migration). Gate honored.
- Step 2 (trusted listing lifecycle): all five sub-steps marked DONE; verified in code — 0001 RLS, 0003/0004/0005 RPCs, `published_revision_id` pointer (0001), outbox events (0003), `scripts/test-authorization-gates.mjs` exists and is wired to `npm run test:auth` in package.json. The gate marker "VERIFIED" is consistent with the test suite's existence; its content covers buyer gate, tenant isolation, and moderator gate as claimed.
- Step 3 (media ingestion): steps 3.1, 3.2, 3.5 marked DONE and verified (0006 buckets/policies; `src/lib/media/upload.ts` SHA-256 pipeline). Step 3.3 honestly "IN PROGRESS", 3.4 "worker pipeline staged" — matches the absence of any worker code.
- Step 4 (buyer discovery): all five DONE; verified (read model, FilterBar/ListingCard, `/saved`, similar strip, viewing form, gallery relocation commit `7807e61`, homepage from `fetchPublishedFeatured`).
- Step 5 (retrieval + native Simon): mostly DONE. The eval dataset and harness exist; but note the harness measures lexical/BM25-style token overlap scoring (`scripts/run-retrieval-eval.mjs` `scoreDocument`/`tokenize`), NOT embedding-based retrieval — there is no embedding call anywhere in the script. The claimed "MRR 1.000" metrics are therefore a keyword-overlap benchmark, not a vector-retrieval benchmark; the doc's phrasing "Evaluate existing/free-tier text embedding ... options against it" is NOT what the script does. This is the single most overstated claim in the sequence document.
- Step 5.4-5.7: verified (chat route, page context, 0007, NativeSimonChat). One claim is now inaccurate: step 5.4 says `NativeSimonChat.tsx` is "integrated in `SimonLauncher.tsx`" and step 5.7 cites a "toggle button in `SimonLauncher.tsx`" for switching to legacy Chainlit. **No file named `SimonLauncher.tsx` exists anywhere in the repo** (find across the tree returns nothing), and `NativeSimonChat`'s `onSwitchToLegacy` prop (`src/components/simon/NativeSimonChat.tsx:27`) is declared but never passed by any caller — the Simon surfaces were since reworked into the docked sidebar (`SimonDockedSidebar.tsx`). The Chainlit-toggle claim is stale code naming.
- Step 6 (advanced workflows): steps 6.1, 6.3, 6.4, 6.5 marked DONE and verified (draft-assist route + `AIDraftingModal.tsx`; 0009 preferences; 0008 outbox + `/api/internal/outbox` with `service_role`-only grants at 0008:86-92; `purge_buyer_personal_data` at 0009:140). Step 6.2 (research workflows) correctly has no DONE marker — not implemented.
- All four gates carry "VERIFIED" markers; the verification artifacts (test scripts) exist for the first three. The final gate ("every automated action remains less authoritative...") is a policy statement, not testable here.

### Verdict
**FOLLOWED.** Build order matches the planned sequence; DONE/IN-PROGRESS markers are accurate for all but two items: the retrieval eval is lexical not embedding-based (overstated metrics), and `SimonLauncher.tsx` is a file that no longer exists (stale reference in steps 5.4/5.7).

---

## 3. docs/plans/phase1-migration-runbook.md — verdict: FOLLOWED (superseded-in-part, accurately self-updated)

### What it planned
Owner-executed application of migration 0001 to the fresh project `nokarvewyorsupraufdg` via dashboard SQL editor, with pre-flight, verify, and rollback scripts.

### What the code shows
- The target migration `supabase/migrations/0001_tenancy_and_lifecycle.sql` exists with exactly the 18 tables the runbook's verify query lists (18 `CREATE TABLE` statements counted).
- The runbook's own status line records "Status 2026-10-12: APPLIED" via the Supabase MCP instead of the SQL editor, and explains why (IPv4/IPv6 network constraint) — an honest, documented deviation from the planned application path.
- Post-apply hardening (search_path pins, `is_org_internal` SECURITY DEFINER helper replacing the inline `is_internal` subquery) is described and ADR-017 (`c7642b2`) plus hardening commits (`cf42bad`, `a809b6c`) corroborate.
- ADR-017 in `docs/architecture/decisions.md` records the same project ref and decision as the runbook.
- The rollback script's object list matches migration 0001's tables/functions/enums.

### Verdict
**FOLLOWED.** The runbook is a historical operational record that was executed as written (with the documented MCP-instead-of-SQL-editor substitution). It is now effectively a completed one-time document; its guidance remains valid for future migrations.

---

## 4. docs/plans/schema-discovery-brief.md — verdict: FOLLOWED (as the discovery artifact it planned to be; now historical)

### What it planned
The first implementation task: a read-only inventory of the inherited Supabase (15 relations + 1 RPC), Simon prototype usage map, Storage/Qdrant state, field classification under ADR-014, migration constraints, and a 16-item verification backlog, with a no-secrets attestation.

### What the code shows
- The brief itself is complete and internally consistent: 15 relations with row counts, section 3 field classification, section 9's 16 backlog items, section 10 attestation.
- Its downstream consequences are visible in the codebase: the restricted-field set it flagged (`address`, `latitude`, `longitude`, exact contact data) is enforced in `src/lib/retrieval/document-recipe.ts` `RESTRICTED_FORBIDDEN_FIELDS` and the eval harness's security gate (run-retrieval-eval.mjs step B checks `exact_address`, `owner_phone`, `status_token_hash` leakage).
- The `schema_migrations`-ownership concern it raised (section 8) was resolved structurally by ADR-017 — the fresh project sidesteps the legacy ledger.
- Backlog items requiring `SUPABASE_DB_PASSWORD` (items 1-16): the runbook and open-questions doc record that direct DB access remained blocked on this IPv4 network as of 2026-10-12; whether any backlog items have since been executed via MCP is not recorded in any doc. Several (pg_policies dump, enum lists) were implicitly done during migration authoring, but the brief's backlog was never formally closed out.

### Verdict
**FOLLOWED** as a discovery deliverable that fed Phase 0/1 exactly as the implementation sequence required. It is now historical (ADR-017 moved the database), which the open-questions doc correctly records. Minor gap: the 16-item verification backlog was never explicitly retired or annotated as done/skipped anywhere.

---

## 5. docs/plans/open-questions.md — verdict: PARTIALLY FOLLOWED (tracking discipline good; items stale)

### What it planned
A living list of owner decisions; resolved items retired into the ADR log (Q1-Q5, Q8 → ADR-012/013/014/015/016, done 2026-10-11).

### What the code shows
- Retirement protocol was followed: ADR-012 through ADR-016 exist in `docs/architecture/decisions.md` with matching rationale.
- Q6 (deployment topology): still open, correctly deferred — no topology ADR exists; nothing in code contradicts deferral.
- Q7 (operational configuration): the item's inline 2026-10-12 updates (IPv6-only DB endpoints, LangSmith 403, missing Tavily key, dead Gemini key) are status annotations, but no doc records whether any of these were later resolved. The outbox/privacy work (0008/0009) proceeded via REST/MCP, so the blocker held, but the item is 11 months of work stale in framing ("the DB password matters most for the Phase 1 listing lifecycle" — Phase 1 is now complete without it).
- Q9 (unknown external writer): correctly downgraded to non-blocker by ADR-017; its pointer to backlog item 16 is accurate. Still unresolved by design.
- Numbering note: the file has Q6, Q7, Q9 with no Q8 section body (Q8 was retired inline in the header note) — self-consistent but reads as a gap to a newcomer.

### Verdict
**PARTIALLY FOLLOWED.** The retire-into-ADR mechanism works and was used; but Q7's statuses are stale (no post-2026-10-12 resolution recorded for the four keys/password despite Phase 1-6 work completing), and the file has not been re-triaged since the 0002-0009 migration wave.

---

## 6. STALE / WRONG claims in docs/architecture/current-state.md

The current-state doc is dated 2026-10-14 and is broadly accurate against the code. Verified-accurate claims include: all migration descriptions 0001-0009 (functions verified present at the cited lines), the owner/moderator portals, media pipeline, conversation/outbox/privacy test suites (all 7 scripts exist and match the `test:*` scripts in package.json), and the "Files that remain intentionally untouched" list. The following claims are stale or wrong:

1. **WRONG: `.claude-flow/` and `prompt.txt` described as "untracked local artifacts" (current-state.md:79).** Both are tracked in git: 5 files under `.claude-flow/` are in the index (`.claude-flow/data/pending-insights.jsonl`, `harness-active-policy.json`, `mods/session.json`, `policy/ledger-anchors.json`, `policy/state.json`) and `prompt.txt` is tracked (commit `b01ecb4 "added everything so i can trace all readme .mds..."` staged them). They are in fact also modified in the working tree right now. Only `Simon.env` is correctly untracked/ignored (`.gitignore` lines 34-35: `.env*`, `*.env`).
2. **STALE: "24 routes" (current-state.md:62).** Counting `page.tsx` and `route.ts` files under `src/app/` yields 21. Minor drift; the number appears in the "Current technical facts" table.
3. **STALE (inherited from implementation-sequence, echoed here): no `SimonLauncher.tsx` exists** — the chat surface is `SimonDockedSidebar.tsx` + `NativeSimonChat.tsx` in `src/context/SimonContext.tsx` wiring. current-state.md itself describes the docked sidebar correctly, so this is only wrong where the plan doc cites the launcher file.
4. **GAP (not claimed, but should be): no CI, no unit test framework.** There is no `.github/` directory and no test runner in package.json — the seven "test suites" are standalone `.mjs` scripts that hit the live production Supabase project via `SUPABASE_ACCESS_TOKEN` from `.env.local` (see `scripts/test-authorization-gates.mjs:17-27`). No doc claims CI exists, but no doc records that these suites require live production credentials and cannot run in CI as written — a notable operational omission given the security doc's "Security verification before launch" section calls for CI pipeline checks ("Secret scanning and log-redaction checks in CI and deployment pipelines", security-data-boundaries.md).
5. **STALE: "It is not yet a native LUXONN backend API" (current-state.md:7, describing `../simon`).** Partly true — the Python service is still external — but `/api/simon/chat` and `/api/owner/draft-assist` now provide native LUXONN API surfaces with a conditional FastAPI pass-through, so the phrasing understates current state.
6. **MINOR: "30 published Kenyan residences" (current-state.md:62).** Consistent with the seed doc's claim (20 curated imports + 10 demo seed rows from `supabase/seeds/0001_demo_inventory.sql`), but the demo seed commits (`7574445`) predate the curated import (`adcf16a`) and the doc does not state that 10 of the 30 are demo inventory, not curated imports. Buyer-facing claims of "canonical Kenyan database residences" (implementation-sequence step 4.4) should be read with that caveat.

---

## 7. Referenced-but-missing documents

All cross-references in the audited docs resolve. Specifically verified:
- `docs/HANDOFF.md` — exists (referenced by docs/README.md).
- `docs/agent-service/simon-boundary.md` — exists (referenced by docs/README.md and contracts.md, via the `../agent-service/` relative path from architecture/, which resolves correctly).
- `docs/architecture/contracts.md` — exists and is the contract-of-record the roadmap Phase 0 required.

No plan document references a file that does not exist. One stale-reference issue exists but is to code, not docs: `SimonLauncher.tsx` cited in implementation-sequence.md steps 5.4 and 5.7 does not exist in the repo (see section 2).

---

## STATUS: COMPLETE

### Executive summary (10 lines)
1. Overall: plan discipline is high — build order, gates, and DONE markers in implementation-sequence.md match the code almost everywhere; contracts were frozen before migrations as the gate required.
2. marketplace-roadmap.md: PARTIALLY FOLLOWED — Phases 0-2 delivered faithfully; Phase 3 lacks EXIF/captioning/Qdrant handlers; Phase 4 lacks ADR-016 rate limiting; Phase 5's draft-assist is a heuristic Next.js route, not the planned Deep Agent/LangGraph workflow.
3. implementation-sequence.md: FOLLOWED with two overstatements — the retrieval eval is lexical token-overlap, not embedding-based (claimed MRR 1.000 does not measure vector retrieval), and `SimonLauncher.tsx` no longer exists.
4. phase1-migration-runbook.md: FOLLOWED — executed as written with a documented MCP-instead-of-SQL-editor substitution; now a completed historical record.
5. schema-discovery-brief.md: FOLLOWED — its ADR-014 field classification is enforced in code (`document-recipe.ts`, eval security gate); its 16-item verification backlog was never formally closed out.
6. open-questions.md: PARTIALLY FOLLOWED — the retire-into-ADR protocol works (Q1-Q5, Q8), but Q7 key/password statuses are 11 months stale and the file was not re-triaged after the 0002-0009 wave.
7. current-state.md is mostly accurate but WRONG that `.claude-flow/` and `prompt.txt` are untracked (both are git-tracked) and slightly stale on route count (says 24, actual 21).
8. No CI and no test runner exist: all seven "test suites" are .mjs scripts that run against the live production Supabase project using SUPABASE_ACCESS_TOKEN from .env.local — unrecorded, and in tension with the security doc's CI requirement.
9. Referenced-but-missing: none — all doc cross-references resolve, including HANDOFF.md and agent-service/simon-boundary.md.
10. Most urgent follow-ups: implement ADR-016 server-side rate limits before anonymous chat scales; correct the retrieval-eval framing (lexical vs embedding); fix the untracked-artifact claim; move test suites off live production credentials or add CI.
