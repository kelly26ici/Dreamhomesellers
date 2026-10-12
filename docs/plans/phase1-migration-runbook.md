# Phase 1 migration runbook — applying 0001_tenancy_and_lifecycle

**Audience:** the owner (Kelly). Written 2026-10-12 by the overnight agent session.
**Scope:** how to apply `supabase/migrations/0001_tenancy_and_lifecycle.sql` to the production Supabase project, verify it, and roll back if needed. No agent will ever apply this — application is deliberately an owner action (ADR-015 posture; also enforced by the discovery brief's finding that an unknown external service writes to this database).

## Why you, and why the SQL editor

- **Network fact (probed 2026-10-12):** this project's Postgres endpoints are IPv6-only and your network is IPv4-only. Direct `psql`/asyncpg connections cannot work from this machine at all. The dashboard SQL editor goes over HTTPS and is the one path that works.
- **Safety fact:** the migration is additive-only — it creates 16 new tables, 3 enum types, and 3 helper functions, and never touches any of the 15 inherited relations (open question 9: an unidentified external service writes to some of them; we do not risk breaking it).
- **Credential rule:** never apply with the service-role key in a script; the dashboard session is your own owner identity.

## Pre-flight (2 minutes)

1. Open the Supabase dashboard → your project (`ahylzmgsfeghojpleozg`).
2. **Connect the Supabase MCP server** (you mentioned you will) — optional, but it lets the next agent session inspect schema state read-only instead of asking you.
3. Take the one-line backup the dashboard offers (Database → Backups) if you are within the free-tier window where that exists; otherwise note that all 16 tables are new names — the migration cannot lose existing data by construction, and rolling back is `DROP TABLE ... CASCADE` on new names only (script below).
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

-- 3. No inherited relation was touched (names unchanged, all present):
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('properties','property_images','agents','scheduled_viewings',
  'property_inquiries','property_submissions','property_moderation_events',
  'property_reports','conversation_messages','conversation_summaries',
  'customer_profiles','bot_settings','request_outbox','mpesa_transactions',
  'schema_migrations')
ORDER BY tablename;
-- Expected: all 15 still listed
```

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
DROP TYPE IF EXISTS public.listing_lifecycle_state;
DROP TYPE IF EXISTS public.revision_state;
DROP TYPE IF EXISTS public.viewing_request_state;
DROP TYPE IF EXISTS public.handoff_state;
COMMIT;
```

After rollback, the database is exactly as before — inherited tables untouched throughout.

## After you apply

- Tell the next agent session (or just say "migration applied"); the verification-backlog items that need catalog access (pg_policies dump, `rls_auto_enable` body, enum value lists, trigger inventory — discovery brief §9) become runnable **read-only** through the MCP server you are connecting, and the Phase 1 vocabulary freezes (`ListingKind`, `PropertyType`, `Availability`, `PricePeriod`, viewing `mode`) can proceed from real `pg_enum` values instead of prototype inference.
- The import path (staging the 4,259 inherited rows as unverified) remains a separate, later decision — nothing in this migration moves any inherited data.
