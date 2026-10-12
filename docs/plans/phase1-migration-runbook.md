# Phase 1 migration runbook — applying 0001_tenancy_and_lifecycle

**Audience:** the owner (Kelly). Written 2026-10-12 by the overnight agent session; updated the same night for ADR-017 (fresh project).
**Scope:** how to apply `supabase/migrations/0001_tenancy_and_lifecycle.sql` to the **new** production Supabase project, verify it, and roll back if needed. No agent will ever apply this — application is deliberately an owner action.

## Target project (ADR-017)

The marketplace database is the fresh project in the "dream home sellers" organization — project ref `nokarvewyorsupraufdg`, region eu-west-1 (Ireland), verified empty on 2026-10-12 (REST OpenAPI showed zero tables). The inherited Samantha-workspace project is an import source only and is never the target of this migration.

## Why you, and why the SQL editor

- **Network fact (probed 2026-10-12):** both projects' direct `db.*` hosts are IPv6-only and your network is IPv4-only; no Supavisor pooler is enabled yet on the new project (enabling one in Dashboard → Database → Connection Pooling would create the IPv4 path). The dashboard SQL editor goes over HTTPS and works tonight.
- **Safety fact:** the target schema is empty — the migration cannot collide with anything or lose any data by construction. (The additive-only constraint in the migration's header exists to protect the *legacy* project during future import work; on the fresh project it is trivially satisfied.)
- **Credential rule:** never apply with the service-role key in a script; the dashboard session is your own owner identity.

## Pre-flight (2 minutes)

1. Open the Supabase dashboard → the dream-home-sellers project (`nokarvewyorsupraufdg`).
2. **Connect the Supabase MCP server** (you mentioned you will) — optional, but it lets the next agent session inspect schema state read-only instead of asking you.
3. Take the one-line backup the dashboard offers (Database → Backups) if you are within the free-tier window where that exists; otherwise note that all 18 tables are new names — the migration cannot lose existing data by construction, and rolling back is `DROP TABLE ... CASCADE` on new names only (script below).
4. Read the migration file once: `supabase/migrations/0001_tenancy_and_lifecycle.sql`. Every table has a comment tying it to its ADR and the contracts doc.

## Apply (5 minutes)

1. Dashboard → **SQL Editor** → New query.
2. Open `supabase/migrations/0001_tenancy_and_lifecycle.sql`, copy the **entire file**, paste into the editor.
3. Click **Run**. It is one transaction (`BEGIN; … COMMIT;`) — it either fully applies or fully fails; there is no partial state.
4. Expected result: `Success. No rows returned` (DDL produces no rows).

## Verify (5 minutes)

Run these in the SQL editor, one at a time:

```sql
-- 1. All 18 new tables exist:
SELECT count(*) FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'owner_organizations','owner_organizations_memberships','platform_roles',
  'properties_lux','listings','listing_revisions','listing_media',
  'media_observations','visual_dossiers','embedding_provenance',
  'moderation_cases','moderation_decisions','moderation_pre_checks',
  'viewing_requests','handoffs','audit_records','outbox_events',
  'org_contact_candidates'
);
-- Expected: 18

-- 2. RLS is enabled on every new table (the security posture):
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'owner_organizations','owner_organizations_memberships','platform_roles',
  'properties_lux','listings','listing_revisions','listing_media',
  'media_observations','visual_dossiers','embedding_provenance',
  'moderation_cases','moderation_decisions','moderation_pre_checks',
  'viewing_requests','handoffs','audit_records','outbox_events',
  'org_contact_candidates'
)
ORDER BY rowsecurity, tablename;
-- Expected: every row shows rowsecurity = true

-- 3. You are on the RIGHT project (guard against pasting into the legacy one):
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('properties','property_images','agents','scheduled_viewings',
  'property_inquiries','property_submissions','property_moderation_events',
  'property_reports','conversation_messages','conversation_summaries',
  'customer_profiles','bot_settings','request_outbox','mpesa_transactions',
  'schema_migrations')
ORDER BY tablename;
-- Expected: 0 rows. The legacy relations exist only in the inherited project.
-- If ANY row appears, you are connected to the WRONG project — stop and rollback.

-- 4. RLS runtime smoke test (policies execute without recursion errors):
--    As a non-bypass role, every org-scoped table must return a count without error.
SET ROLE authenticated;
SELECT count(*) FROM public.owner_organizations_memberships;
SELECT count(*) FROM public.listings;
SELECT count(*) FROM public.listing_revisions;
SELECT count(*) FROM public.moderation_cases;
SELECT count(*) FROM public.viewing_requests;
SELECT count(*) FROM public.handoffs;
RESET ROLE;
-- Expected: every count returns 0 (empty tables, RLS-filtered) with NO error.
-- An "infinite recursion detected in policy" error means the helper-function fix
-- did not apply — do not proceed.
```

**If you paste the migration twice:** you will see "already exists" errors — that is harmless; the transaction rolled back and nothing changed. Run the Verify queries instead of re-running the migration.

## Rollback (if anything looks wrong)

The migration is additive; rollback drops only the new objects. Run in the SQL editor:

```sql
BEGIN;
DROP TABLE IF EXISTS
  org_contact_candidates, outbox_events, audit_records,
  handoffs, viewing_requests, moderation_pre_checks, moderation_decisions,
  moderation_cases, embedding_provenance, visual_dossiers, media_observations,
  listing_media, listing_revisions, listings, properties_lux,
  platform_roles, owner_organizations_memberships, owner_organizations
  CASCADE;
DROP FUNCTION IF EXISTS public.current_app_user_id();
DROP FUNCTION IF EXISTS public.current_user_org_ids();
DROP FUNCTION IF EXISTS public.current_platform_role();
DROP FUNCTION IF EXISTS public.is_org_admin(uuid);
DROP FUNCTION IF EXISTS public.is_org_internal(uuid);
DROP FUNCTION IF EXISTS public.guard_revision_state();
DROP FUNCTION IF EXISTS public.guard_listing_state();
DROP FUNCTION IF EXISTS public.guard_media_revision();
DROP FUNCTION IF EXISTS public.audit_records_reject_mutation();
DROP TYPE IF EXISTS public.listing_lifecycle_state;
DROP TYPE IF EXISTS public.revision_state;
DROP TYPE IF EXISTS public.viewing_request_state;
DROP TYPE IF EXISTS public.handoff_state;
COMMIT;
```

This exact script was tested against the hardened migration on a scratch PostgreSQL 18.6 cluster on 2026-10-12: apply → verify → rollback → residue check all passed (zero residual tables, enums, functions, indexes, or policies).

After rollback, the database is exactly as before — inherited tables untouched throughout.

## After you apply

**Status 2026-10-12: APPLIED** — via the Supabase MCP `apply_migration` (owner-directed after confirming IPv4 direct DB is unavailable; the SQL-editor path above remains valid for future migrations). Verified through MCP: 18/18 tables, 18/18 RLS-enabled, 18/18 FORCE RLS, and the runtime smoke test passes for both `anon` and `authenticated` roles.

Post-apply hardening applied the same day (all mirrored into the migration file):

- The four trigger functions (`audit_records_reject_mutation`, `guard_revision_state`, `guard_listing_state`, `guard_media_revision`) got pinned `search_path` (security-lint advisor fix).
- A production smoke test caught a real bug: `listing_public_read` referenced `owner_organizations.is_internal` inline, but column grants deliberately withhold that column from clients — RLS policies run with the *caller's* privileges, so anonymous listing reads failed with `permission denied`. Fixed by adding the `is_org_internal(uuid)` SECURITY DEFINER helper and rewriting the policy to call it. `is_internal` remains hidden; the policy now runs with the table owner's privileges.

The verification-backlog items that need catalog access (pg_policies dump, `rls_auto_enable` body, enum value lists, trigger inventory — discovery brief §9) are now runnable read-only through the MCP server, and the Phase 1 vocabulary freezes (`ListingKind`, `PropertyType`, `Availability`, `PricePeriod`, viewing `mode`) can proceed from real `pg_enum` values instead of prototype inference.

The import path (staging the 4,259 inherited rows as unverified) remains a separate, later decision — nothing in this migration moves any inherited data.
