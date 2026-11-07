# Skill-Conformance Verification — LUXONN / dreamhomesellers

Verification of `supabase/migrations/0001`–`0009` against two loaded skills:

- `.claude/skills/supabase/SKILL.md` (project skill, Supabase security checklist + workflow)
- `.claude/skills/supabase-postgres-best-practices/SKILL.md` + `references/*.md` (Postgres rules by priority)

Method: skills loaded first via the Skill tool, then migrations read in order and compared rule-by-rule. Findings appended progressively.

## In progress...

Note: the task described 9 migrations; `supabase/migrations/` actually contains 10 (0001–0010). 0010 (`0010_outbox_backoff_dead_letters_health_purge.sql`) is included in scope below.

## Section 1 — `supabase` skill (project skill) vs migrations 0001–0010

### 1a. RLS policy patterns

**Force RLS — EXCEEDS baseline.**
The skill's checklist says "Enable RLS on every table in any exposed schema". The migrations go beyond: every table in every migration gets both `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` (e.g. 0001:800–801, 826–827, 869–870, 891–892, 997–998, 1000–1001, 1003–1004, 1126–1130, 1133–1134; header comment line 25 explicitly cites "postgres owner bypass closed"). The skill only mentions FORCE in the *postgres-best-practices* rule file (`security-rls-basics.md`, "Force RLS even for table owners"); the supabase skill itself doesn't mention it. The project applies the stricter of the two skills' guidance everywhere. No table with RLS enabled but not forced was found.

**Policies per role / per action — EXCEEDS baseline.**
The skill warns against the one-size-fits-all `auth.uid()` pattern ("create policies that match the actual access model rather than defaulting every table to the same `auth.uid()` pattern"). Migration 0001 does exactly this: separate `public_read` / `org_read` / `org_write` / `moderator_all` policies per table, plus explicit service-lane tables (media_observations, visual_dossiers, embedding_provenance, audit_records, outbox_events) that have RLS enabled, FORCE on, and **no client policies at all** — default deny (0001:993–1004, 1125–1130, comment at 993–996). The `TO` clause is used implicitly through column grants + policies; see caveat below.

**UPDATE requires SELECT policy — CONFORMS.**
Skill checklist: "UPDATE requires a SELECT policy … without a SELECT policy, updates silently return 0 rows". Every table with an UPDATE policy also has a SELECT policy for the same accessor (e.g. viewing_requests: `viewing_org_read` 0001:1063 + `viewing_requester_read` 0001:1075 + `viewing_org_update` 0001:1082; handoffs same pattern 0001:1098–1121). No UPDATE policy without a matching SELECT path was found.

**WITH CHECK on writes — EXCEEDS baseline.**
Skill requires `WITH CHECK` on UPDATE policies to prevent `user_id` reassignment. Every `FOR ALL` and `FOR UPDATE` policy in 0001 carries both `USING` and `WITH CHECK` with the identical predicate (0001:814–823, 841–850, 879–888, 916–925, 948–957, 982–991, 1010–1013, 1032–1035, 1047–1050, 1082–1091, 1112–1121, 1143–1152). Tables where identity cannot drift (no client write path at all) omit policies entirely, which is stronger.

**`TO` clause usage — partial / deliberate deviation, flagged.**
The skill says `auth.role()` is deprecated and to use `TO authenticated` / `TO anon` on policies. **No policy in any migration uses a `TO` clause.** All policies rely on `auth.uid()`-derived helpers returning NULL for unauthenticated callers, plus column-level `GRANT/REVOKE` (0001:1164–1204) to control which roles reach which columns. This is not the deprecated `auth.role()` pattern, so the skill's hard rule is not violated; but the skill's preferred `TO authenticated` form is absent. Because row visibility is instead gated by `current_app_user_id()` (NULL when unauthenticated) and org/platform-role helpers, anon users do not get row access through user-identity policies — the functional guarantee the `TO` clause addresses is met via other means. Not a REQUIRED violation; a stylistic divergence from the skill's canonical form worth noting.

**BOLA / IDOR (TO authenticated alone) — CONFORMS.**
The skill's "TO authenticated alone is authentication without authorization" trap is structurally avoided: every identity-bearing policy predicate is an ownership predicate (`user_id = (SELECT public.current_app_user_id())`, `organization_id IN (SELECT public.current_user_org_ids())`). No policy grants all authenticated users all rows of anything.

**user_metadata in authorization — CONFORMS (absent).**
Grep across all migrations: no `user_metadata`, `raw_user_meta_data`, or `app_metadata` usage in RLS or functions. Authorization data lives in `platform_roles` / `owner_organizations_memberships` tables. (JWT freshness caveat the skill raises therefore doesn't apply to role checks — roles are read from tables, not from stale JWT claims. This is actually stronger than the skill's baseline assumption.)

**Views bypassing RLS — CONFORMS (absent).**
No `CREATE VIEW` in any migration (grep). No `security_invoker` concern arises.

**Update to findings file (progress): section 1a complete.**

### 1b. SECURITY DEFINER function conventions

**Skill REQUIRED form** (SKILL.md checklist + `security-rls-performance.md` reference): when SECURITY DEFINER is genuinely needed, keep it in a non-exposed schema, **always include an `auth.uid()` check in the function body**, and revoke `EXECUTE` from roles that shouldn't call it. The reference's canonical pinning is `set search_path = ''` (or an explicit safe list).

**search_path pinning — conforms in 0001–0006, weaker in 0007/0009, self-corrected in 0008/0010.**
Every SECURITY DEFINER function across all migrations pins search_path; no function leaves it unpinned. Variants found:

- `pg_catalog, public` (0001, 0006, 0010; and quoted `TO 'pg_catalog', 'public'` in 0003/0004/0005) — the project's stated convention ("Conventions follow migrations 0001-0007 (search_path = pg_catalog, public)", 0010:5). Good.
- `pg_catalog` alone on 0001's four trigger functions (0001:658, 725, 750, 779) — these are guards over a single table; acceptable.
- **`public, pg_temp`** on 0007:75, 0007:137 (save_conversation_turn, get_conversation_history) and 0009:61, 0009:101 (upsert_buyer_preferences, get_buyer_preferences) — public is searched BEFORE pg_catalog, so a shadowing object in `public` (where anon/authenticated historically could hold CREATE in older Supabase grants) could hijack builtin resolution. Soft violation of the skill's safe-pinning intent; the project itself treats this shape as deficient — 0010's header explicitly calls section 2 "search_path hardening" and rewrites 0008's three functions from `public, pg_temp` to `pg_catalog, public` (0010:60, 86, 104). The same hardening was NOT applied to the remaining five functions.
- `public, extensions, pg_temp` on 0007:196 (create_handoff) and 0009 purge v1 (rewritten in 0010:214 to `pg_catalog, public, extensions`).

**In-body auth check — one REQUIRED-rule violation.**
Skill (SKILL.md, RLS/privileged-code section): "When SECURITY DEFINER is genuinely needed …, keep the function in a non-exposed schema, **always include an `auth.uid()` check in the function body**…". The project's idiom is stronger than the skill's minimum in most places: every owner/moderator RPC (0002, 0003, 0004, 0005) begins with an explicit `v_uid IS NULL` rejection AND an explicit membership/role re-check, because "SECURITY DEFINER bypasses RLS, so the membership check must be explicit" (0004:41-42, 0003:16). The three outbox worker functions (0008, rewritten 0010) have no in-body auth check but are `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role` only (0010:149-155) — the skill's alternative control ("revoke EXECUTE from any role that shouldn't call them directly"), so conforms.

**VIOLATION — `save_conversation_turn` (0007:63-128):** SECURITY DEFINER, granted to `anon, authenticated` (0007:369), reads `v_uid := (SELECT auth.uid())` but performs **no ownership check on `p_thread_id` before writing**. The upsert at 0007:87-95 (`ON CONFLICT (thread_id) DO UPDATE SET user_id = COALESCE(v_uid, …)`) followed by unconditional message INSERTs at 0007:99-119 means any caller who learns another user's `thread_id` can append messages into that thread (and flip `page_context`). The read path (`get_conversation_history`, 0007:150-156) DOES verify ownership — the write path is the gap. This fails the skill's REQUIRED "always include an auth.uid() check in the function body" for a public-callable SECURITY DEFINER function, and is a genuine cross-tenant write surface.

**Location in `public` schema — deviation with compensating controls.**
The skill prefers non-exposed schemas; all project functions live in `public`. Compensation: nearly every function carries `REVOKE ALL ON FUNCTION … FROM public/PUBLIC` plus a narrow `GRANT EXECUTE` (0002:276-277, 0003:58/263/384/546/722/842/1034/1141, 0004:46-47/168-169/290-291, 0005:43-44/90-91/170-171/304-305/671-672, 0006, 0009, 0010). 0009:225 over-granted `get_platform_operational_health` to `anon` — a real over-exposure of platform telemetry — but 0010:161-162 and 0010:203-204 revoke it from anon and re-grant to authenticated/service_role only. Net current state conforms; the fix is exactly what the skill's "run `supabase db advisors` after making changes" workflow is designed to catch.

**Running with definer privileges to break policy recursion — exceeds baseline.**
0001's five policy helpers (current_app_user_id, current_user_org_ids, current_platform_role, is_org_admin, is_org_internal, 0001:111-185) use SECURITY DEFINER deliberately and are documented as the fix for the RLS self-recursion cycle (0001:103-105, 151-153). The skill describes this use case ("bypassing RLS on an internal lookup table") without providing the recursion-breaking pattern; the project's design is a superset.

### 1c. Storage policy conventions (0006)

**Storage upsert rule — CONFORMS.** Skill: "Storage upsert requires INSERT + SELECT + UPDATE." 0006 defines all four on `listing-originals` for authenticated: SELECT (0006:87-97), INSERT with `WITH CHECK` (0006:100-107), UPDATE with both `USING` and `WITH CHECK` (0006:110-121), DELETE (0006:124-131). No insert-only bucket.

**Other conventions — EXCEEDS baseline.**
- `TO authenticated` / `TO anon, authenticated` used correctly (no deprecated `auth.role()` anywhere; grep-verified).
- Org-prefix tenancy via `storage_path_org_id(name)` (0006:61-77), a SECURITY DEFINER parser with pinned search_path; `WITH CHECK` present on the INSERT policy so a client cannot write into another org's prefix.
- Bucket-level hardening the skill doesn't even mention: private originals bucket with 25MB limit + MIME whitelist vs public derivatives bucket with 10MB limit (0006:16-55); public SELECT restricted to the derivatives bucket only (0006:134-138); derivative writes admin-only with USING+WITH CHECK (0006:141-152).
- Minor note: `storage_path_org_id` does not need SECURITY DEFINER (it reads no protected data) and is granted to anon — harmless but broader than necessary.

### 1d. Index conventions

**FK indexes — VIOLATION (the skill's HIGH-impact "Always index the FK column" + RLS-performance "Always add indexes on columns used in RLS policies").**
A full FK-vs-index cross-scan of all migrations found FK columns with no covering index, PK, or UNIQUE constraint:

- `viewing_requests.requester_user_id` (0001:567) — filtered by `viewing_requester_read` (0001:1078) and by `purge_buyer_personal_data` (0010:237). Unindexed.
- `handoffs.requester_user_id` (0001:606) — filtered by `handoff_requester_read` (0001:1108) and purge (0010:241). Unindexed.
- `handoffs.organization_id` (0001:604), `handoffs.viewing_request_id` (0001:603) — org read policy (0001:1100) filters organization_id. Unindexed.
- `listing_revisions.organization_id` (0001:270) — filtered by `revision_org_read`/`revision_org_write` (0001:944, 951). Unindexed.
- `listings.property_id` (0001:229, composite FK `listings_property_same_org_fk`) — no (property_id, organization_id) index; CASCADEs from properties_lux scan.
- `moderation_decisions.organization_id` (0001:510) + `decided_by` (0001:513); `moderation_pre_checks.organization_id` (0001:531); `org_contact_candidates.organization_id` (0001:703) — org read/write policies filter these. Unindexed.
- Service-lane satellites: `media_observations.organization_id` (0001:407), `visual_dossiers.organization_id` (0001:428), `embedding_provenance.organization_id` (0001:446) — no client policies, so lower severity, but still unindexed FKs.
- `listing_revisions.created_by` (0001:298), `listing_revisions.base_revision_id` (0001:316 FK) — unindexed (low traffic).

Counter-examples show the convention was known and applied selectively: `owner_org_memberships_user_idx` (0001:85), `properties_lux_org_idx` (0001:206), `listings_org_idx` (0001:251), `listing_media_org_idx` (0001:395), `moderation_cases_org_idx` (0001:504). The gap is real but concentrated on revision/moderation/handoff org+user columns.

**Composite and partial indexes — EXCEEDS baseline.**
Correct column ordering (equality first): `moderation_cases_queue_idx (case_state, opened_at)` (0001:503), `viewing_requests_org_state_idx (organization_id, request_state)` (0001:588), `audit_records_org_time_idx (organization_id, occurred_at)` (0001:648), `idx_conversation_messages_thread_id (thread_id, created_at ASC)` (0007:43-44). Partial indexes: `outbox_pending` (0001:691), `listings_published` (0001:254), `outbox_scheduled_pending` (0010:16-18) — the 0010 partial index correctly re-keys the worker poll path onto `scheduled_for` after backoff changed the ordering column.

**Primary key strategy — soft deviation.** `schema-primary-keys.md` prefers `bigint identity` or time-ordered UUIDv7 and says "Avoid random UUIDs (v4) as primary keys on large tables". Every table uses `gen_random_uuid()` (uuidv4). Standard Supabase practice and defensible for externally-exposed marketplace IDs, but below the skill's stated optimum for high-insert tables (conversation_messages, audit_records, outbox_events).

**Update to findings file (progress): sections 1b–1d complete.**

## Section 2 — `supabase-postgres-best-practices` skill vs migrations

### 2a. Partitioning (conversation_messages)

`schema-partitioning.md` gate: partition "tables > 100M rows" / time-series with date-based queries / need to drop old data efficiently.

`conversation_messages` (0007:33-41) is a single non-partitioned table with `created_at timestamptz NOT NULL DEFAULT now()` and a `(thread_id, created_at)` index — the textbook time-series shape. **No migration mentions partitioning** (grep across all 10: zero hits). Verdict: **not currently a violation** — a Phase-5/6 buyer-chat table on a Kenya-first marketplace is far from 100M rows, and `purge_buyer_personal_data` deletes per-user, not per-date. But the skill's third trigger ("drop old data efficiently") is unaddressed: contracts.md:693 flags that the legacy system's conversation data has "no retention policy", and no retention/rollout plan exists for the new table. If conversation retention is ever legislated (Kenya DPA storage limits), a non-partitioned table makes bulk expiry a long-running DELETE. Recommendation-level: document a partition-by-range (created_at) fallback plan or a retention job, don't partition now.

### 2b. Pagination

`data-pagination.md`: OFFSET pagination scans skipped rows; prefer keyset/cursor; for multi-column sorts, cursor must include all sort columns via row-comparison.

Read paths surveyed:
- `owner_listings_summary` (0004): returns the org's FULL listing set as one jsonb_agg — no LIMIT, no OFFSET, no cursor. Unbounded as org inventory grows; same for `owner_listing_revision` (single revision, fine) and `moderator_cases_summary` (0005:96-170): full queue, only ordered, no paging parameters.
- `get_conversation_history` (0007:130-177): aggregates the ENTIRE thread with `jsonb_agg … ORDER BY m.created_at` — unbounded per-thread, and the RPC contract has no cursor.
- `get_revision_media` (0006): media per revision is small (position-ordered), acceptable unbounded.
- No OFFSET appears anywhere in the SQL (grep: 0 hits) — so the skill's specific anti-pattern is absent; the gap is absence of ANY pagination on three list RPCs.

Verdict: **no REQUIRED violation** (the skill forbids OFFSET, not unbounded RPCs), but three RPCs will degrade O(n) with data volume and should grow `p_limit`/`p_cursor` parameters before the owner portal or moderation queue scales. The app layer's PostgREST usage (read-model.ts) can use range headers, which is the Supabase-idiomatic fix.

### 2c. Connection pooling

`conn-pooling.md` (CRITICAL): pool between app and database; transaction mode for most apps. This is app/config-level, not migration-level: no config.toml exists in the repo (no `supabase/config.toml` — only `migrations/` and `seeds/`), so pooling is entirely a client concern. The app connects exclusively via supabase-js over the Data API (`src/lib/marketplace/read-model.ts` createClient; `src/app/api/internal/outbox/route.ts` createClient), which routes through Supabase's hosted pooler — so the CRITICAL rule is satisfied by architecture (no direct Postgres connections from the app). The outbox consumer creates a new supabase-js client per request (outbox/route.ts:21) — an HTTP-client-per-request cost, not a Postgres connection leak, but the module-level memoization pattern used in read-model.ts should be adopted there. No migration work needed.

### 2d. RLS performance (auth.uid() vs subquery)

`security-rls-performance.md`: wrap `auth.uid()` in `(SELECT …)` — "100x+ faster on large tables"; also indexes on policy columns (see 1d violation).

**Conforms — and is documented as a deliberate rule.** Migration 0001's header (lines 26-27) states: "policy helpers wrapped in (SELECT …) inside policies — evaluated once per statement (initplan), not per row (Supabase RLS performance rule)". Verified by grep: **zero** naked `auth.uid()` or `auth.jwt()` calls appear inside any policy predicate across all 10 migrations. Policies use `(SELECT public.current_app_user_id())`, `(SELECT public.current_platform_role())`, `IN (SELECT public.current_user_org_ids())` (0001:807-808, 817, 832-833, 859, 875-876, 909, 951, 1012, 1024, 1034, 1049, 1078, 1101, 1115, 1139, 1146 …). 0007/0009 policies use `(SELECT auth.uid())` directly (0007:31, 55; 0009:34, 40-41) — same wrapped form. The only raw `auth.jwt()` is inside `current_app_user_id` itself (0001:118), which is the intended single chokepoint.

One nuance the skill covers and the project handles: `SET OF uuid` helper (`current_user_org_ids`) inside `IN (SELECT …)` — because the helper is STABLE and wrapped, it initplans. Good.

The skill's other lever — indexes on policy columns — is where this otherwise-excellent scorecard loses points (see 1d: requester_user_id, organization_id on revisions/handoffs/moderation satellites unindexed while being the exact columns the policies filter).

### 2e. Other best-practices rules checked

- **skip-locked (lock-skip-locked.md)** — EXCEEDS baseline: 0008/0010 `claim_outbox_events` is the reference "atomic claim-and-update in one statement" pattern with `FOR UPDATE SKIP LOCKED` inside an UPDATE subquery (0010:63-76), and 0010 adds exponential backoff + dead-letter table + payload-safety backstop CHECK (0010:45-48) — none of which the skill documents; the project is ahead of its own skill here.
- **Least privilege (security-privileges.md)** — conforms after 0010 (see 1b); column-level GRANT/REVOKE in 0001:1164-1204 is a stricter-than-skill control (row policies can't restrict columns; the project adds a second enforcement layer the skill never mentions).
- **schema-constraints / lowercase identifiers** — conforms: all identifiers lowercase snake_case; heavy CHECK/UNIQUE/FK discipline; composite same-org FK chains (0001:15-18, 243-244, 308-309) enforce tenant integrity at the constraint layer, which no skill rule covers — exceeds baseline.
- **lock-short-transactions** — conforms: domain commands are single-RPC transactions; no long-held locks observed.
- **monitor-explain/pg-stat-statements** — no migration evidence; app-level concern; out of scope for migration conformance.
- **supabase skill workflow rules** — additive-only posture honored (0001:37-39); migrations hand-authored but wrapped in BEGIN/COMMIT with rollback-then-reapply validation documented (0001:50-51); the skill's "run advisors before committing" step is evidenced in 0010's header ("Source: security/database audit 2026-10-15 (audit-findings/)"), suggesting the advisory loop is operating.

**Update to findings file (progress): section 2 complete. Writing exec summary next.**

## STATUS: COMPLETE

## Executive summary (10 lines)

1. VIOLATION (REQUIRED): `save_conversation_turn` (0007:63-128) is SECURITY DEFINER, callable by anon, and writes into any `thread_id` with no in-body ownership check — fails the skill's "always include an auth.uid() check in the function body"; 0007:87-95 upsert + 0007:99-119 inserts are the cross-tenant write surface. (Read path checks ownership; write path does not.)
2. VIOLATION (HIGH): unindexed FK/policy columns — `viewing_requests.requester_user_id` (0001:567), `handoffs.requester_user_id/organization_id/viewing_request_id` (0001:603-606), `listing_revisions.organization_id` (0001:270), `moderation_decisions.organization_id` (0001:510), `moderation_pre_checks.organization_id` (0001:531), `org_contact_candidates.organization_id` (0001:703), `listings.property_id` (0001:229), three AI-satellite org columns (0001:407/428/446) — violates "always index FK columns" and "index columns used in RLS policies".
3. SOFT VIOLATION: five SECURITY DEFINER functions pin `search_path = public, pg_temp` (0007:75, 137; 0009:61, 101) or `public, extensions, pg_temp` (0007:196) instead of the project's own `pg_catalog`-first convention; 0010:54-106 already proved the fix pattern but only applied it to the outbox trio.
4. FIXED-IN-FLIGHT: 0009:225 granted `get_platform_operational_health` to `anon` (over-exposure); 0010:161-162/203-204 revokes anon and narrows to authenticated + service_role — now conforms.
5. STYLISTIC DIVERGENCE (not a violation): no policy in any migration uses the skill's preferred `TO authenticated` form (storage policies in 0006 do); database policies rely on helper-NULL semantics + column grants instead — functionally equivalent, harder to audit at a glance.
6. SOFT GAP: uuidv4 PKs everywhere (`gen_random_uuid()`) vs skill preference for identity/UUIDv7 on large-insert tables (conversation_messages, audit_records, outbox_events).
7. GAP (not required): no partitioning or retention plan for `conversation_messages` (0007:33-41) despite skill trigger "drop old data efficiently" and contracts.md:693 flagging absent retention rules; no pagination parameters on `owner_listings_summary` (0004), `moderator_cases_summary` (0005:96-170), `get_conversation_history` (0007:130-177) — no OFFSET anti-pattern anywhere, just unbounded list RPCs.
8. EXCEEDS BASELINE: FORCE ROW LEVEL SECURITY on every table (0001:800-801 et seq., 0010:39-40); USING+WITH CHECK on every write policy (0001:814-823 et seq.); `(SELECT …)`-wrapped policy helpers documented at 0001:26-27 and verified with zero naked auth.uid() in policies; composite same-org FK chains (0001:243-244); column-level GRANT/REVOKE buyer-safe surface (0001:1164-1204); buyer-safety payload CHECKs (0001 outbox, 0010:45-48).
9. EXCEEDS BASELINE: storage (0006) — all four operations per bucket, WITH CHECK on INSERT/UPDATE, org-prefix tenancy parser, MIME + size limits per bucket; outbox worker (0008/0010) — reference SKIP LOCKED pattern plus exponential backoff and dead letters, beyond anything the skill documents.
10. EXCEEDS BASELINE: all SECURITY DEFINER owner/moderator RPCs (0002-0005) do explicit uid-NULL rejection AND explicit membership/role re-checks with audit-on-reject ("SECURITY DEFINER bypasses RLS, so the membership check must be explicit", 0004:41-42) — a discipline the skill states as a warning but never operationalizes; EXECUTE grants are revoked-from-public and narrowed per function throughout.

Not urgent: no data-loss or privilege-escalation risk beyond finding 1; findings 2-3 are performance/hardening, findings 4's fix already landed.
