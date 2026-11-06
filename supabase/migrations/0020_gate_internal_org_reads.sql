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
    AND NOT public.is_org_internal(organization_id)
  );

COMMIT;
