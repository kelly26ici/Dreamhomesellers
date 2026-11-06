-- =====================================================================
-- Migration: 0019_scope_derivative_reads.sql
-- Description: scope the public read policy on `listing-derivatives` to
--              published, approved revisions, and define the derivative
--              path layout so the policy and the writer cannot drift apart.
--
-- Why this exists: 0006 granted blanket SELECT over the whole bucket:
--
--     CREATE POLICY listing_derivatives_public_select ON storage.objects
--       FOR SELECT TO anon, authenticated
--       USING (bucket_id = 'listing-derivatives');
--
-- so every object in the bucket was reachable by URL regardless of the
-- owning revision's lifecycle or the media row's moderation state.
--
-- Current exposure is zero *by accident*, not by design: the media
-- processing pipeline was never built, so the bucket has no derivatives in
-- it. The moment that pipeline writes its first derivative, they would all
-- be public. This migration makes the bucket safe before that happens.
--
-- Rollback: the pre-image is the 0006 statement quoted above.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Path layout, defined here so policy and writer agree
-- ---------------------------------------------------------------------
-- Two new path parsers, mirroring public.storage_path_org_id(text) from
-- 0006. They parse text only, so they need no SECURITY DEFINER.
--
-- Derivative object paths (defined by THIS migration, implemented by the
-- media processing slice):
--     {organization_id}/{revision_id}/{media_id}/{variant}.{ext}
-- Original object paths (unchanged, from 0006):
--     {organization_id}/{revision_id}/{media_id}.{ext}
--
-- The revision segment is what the policy below filters on, so a path that
-- does not carry a well-formed UUID in that position simply is not public.

CREATE OR REPLACE FUNCTION public.storage_path_segment(p_name text, p_index integer)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN split_part(p_name, '/', p_index)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN split_part(p_name, '/', p_index)::uuid
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.storage_path_segment(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.storage_path_segment(text, integer)
  TO authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. Scoped public read
-- ---------------------------------------------------------------------
-- Three ways a caller may read a derivative, in priority order:
--   (a) it belongs to a published revision of a published listing, and the
--       media row has actually been processed and approved -- this is the
--       buyer path, and it is checked against the same columns
--       media_public_read checks, so storage and the table cannot disagree;
--   (b) the caller is a member of the owning organization -- owners must be
--       able to read their own unpublished derivatives (the media manager
--       depends on this, and the old blanket policy allowed it);
--   (c) the caller is a platform moderator/admin.
DROP POLICY IF EXISTS listing_derivatives_public_select ON storage.objects;
CREATE POLICY listing_derivatives_public_select ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'listing-derivatives'
    AND (
      EXISTS (
        SELECT 1
        FROM public.listing_revisions r
        JOIN public.listings l
          ON l.listing_id = r.listing_id
         AND l.organization_id = r.organization_id
        JOIN public.listing_media m
          ON m.revision_id = r.revision_id
         AND m.media_id = public.storage_path_segment(name, 3)
        WHERE r.revision_id = public.storage_path_segment(name, 2)
          AND r.lifecycle_state = 'published'
          AND l.lifecycle_state = 'published'
          AND m.processing_status = 'processed'
          AND m.moderation_status = 'approved'
      )
      OR public.storage_path_org_id(name) IN (SELECT public.current_user_org_ids())
      OR (SELECT public.current_platform_role()) IS NOT NULL
    )
  );

COMMIT;
