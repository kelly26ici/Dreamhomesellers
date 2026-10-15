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
