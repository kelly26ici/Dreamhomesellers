-- =====================================================================
-- Migration: 0020_gate_internal_org_reads.sql
-- Description: restate the is_org_internal gate on revision_public_read and
--              media_public_read, which listing_public_read already has.
--
-- Why this exists: an internal organization (the curated import-staging
-- org) must never be buyer-visible. listing_public_read enforces that
-- directly; the two policies below reached the same content without the
-- check.
--
-- Honest statement of the current state: these two are NOT exploitable
-- today, because each of them reads `public.listings` in an EXISTS
-- subquery, and that read runs under the caller's own row-level security --
-- which is filtered by listing_public_read. The protection is real, but it
-- is *transitive*: it holds only for as long as listing_public_read keeps
-- its is_org_internal clause and keeps filtering by lifecycle_state.
--
-- That is a fragile dependency to leave implicit in a security boundary, so
-- this migration makes it explicit. A later edit to listing_public_read
-- cannot silently reopen the internal-org leak.
--
-- Rollback: the pre-images are the 0001 statements quoted below.
--
-- ---------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO -- read before applying
-- ---------------------------------------------------------------------
-- 1. It does not make derivative URLs safe. The `listing-derivatives`
--    bucket is currently PUBLIC, and Supabase documents that downloads
--    from a public bucket bypass RLS entirely -- objects are fetchable by
--    URL whatever any policy says. Set the bucket to PRIVATE first, or
--    this migration's table-level gating is not enforced on the file
--    path. Supabase recommends changing bucket visibility through the
--    Storage API rather than by editing storage.* schema directly, so the
--    bucket change is a separate, manual step and not part of this file.
--
-- 2. It does not protect every caller, only anonymous and unrelated
--    buyers. PostgreSQL policies are permissive and combine with OR, so
--    the clause added below narrows *these two policies' public-read
--    branches* and nothing else. listing_org_read still lets an
--    organization member read its own listings, and the platform-role
--    policies still let moderators/admins read anything. Those callers
--    reach the same revisions and media through their own org-read
--    policies. Anyone who could see this content before this migration
--    can still see it; the change removes the *public* route to internal
--    content and keeps the internal-org route closed by restating it.
--
-- 3. media_public_read depends on media-table RLS for its filtering.
--    The derivative policy's buyer branch relies on this policy for
--    processing_status and moderation_status -- it does not test them
--    itself. That dependency is intentional (one place decides what is
--    published media) but it is a dependency: if the media policies
--    change, revisit the derivative policy in the same change.
--
-- Verified while writing this migration: the referenced tables and
-- columns exist; the is_org_internal(organization_id) references sit
-- outside the EXISTS subqueries, so organization_id is the revision or
-- media row being checked rather than the joined listing row.
-- =====================================================================

BEGIN;

-- Pre-image (0001:931-939):
--   CREATE POLICY revision_public_read ON public.listing_revisions
--     FOR SELECT
--     USING (
--       EXISTS (
--         SELECT 1 FROM public.listings l
--         WHERE l.published_revision_id = listing_revisions.revision_id
--           AND l.lifecycle_state = 'published'
--       )
--     );
DROP POLICY IF EXISTS revision_public_read ON public.listing_revisions;
CREATE POLICY revision_public_read ON public.listing_revisions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.published_revision_id = listing_revisions.revision_id
        AND l.lifecycle_state = 'published'
    )
    -- Same gate, same function, same reason as listing_public_read:
    -- is_org_internal is SECURITY DEFINER precisely because is_internal is
    -- withheld from client column grants, so the policy must read it with
    -- the owner's privileges rather than the caller's.
    AND NOT public.is_org_internal(organization_id)
  );

-- Pre-image (0001:963-973):
--   CREATE POLICY media_public_read ON public.listing_media
--     FOR SELECT
--     USING (
--       processing_status = 'processed'
--       AND moderation_status = 'approved'
--       AND EXISTS (
--         SELECT 1 FROM public.listings l
--         WHERE l.published_revision_id = listing_media.revision_id
--           AND l.lifecycle_state = 'published'
--       )
--     );
DROP POLICY IF EXISTS media_public_read ON public.listing_media;
CREATE POLICY media_public_read ON public.listing_media
  FOR SELECT
  USING (
    processing_status = 'processed'
    AND moderation_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.published_revision_id = listing_media.revision_id
        AND l.lifecycle_state = 'published'
    )
    -- See the header: this narrows the public-read branch only. Org members
    -- and platform roles reach these rows through their own policies, which
    -- is intended -- they are allowed to.
    AND NOT public.is_org_internal(organization_id)
  );

COMMIT;
