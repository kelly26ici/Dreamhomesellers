-- =====================================================================
-- Migration: 0019_scope_derivative_reads.sql
-- Description: scope the public read policy on `listing-derivatives` to
--              published revisions, and define the derivative path layout
--              so the policy and the writer cannot drift apart.
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
--
-- ---------------------------------------------------------------------
-- COLUMN-GRANT CONSTRAINT (why this policy is written the way it is)
-- ---------------------------------------------------------------------
-- 0001:1164-1190 revokes table-level SELECT from anon/authenticated and
-- carves back buyer-safe columns:
--
--   listings           -> listing_id, listing_kind, lifecycle_state,
--                         published_revision_id
--   listing_revisions  -> revision_id, listing_id, <public content>,
--                         published_ref_revision_id
--   listing_media      -> media_id, revision_id, position, kind,
--                         is_featured, derivative_paths
--
-- So organization_id, revision_state, processing_status and
-- moderation_status are NOT readable by anon. This policy therefore
-- references ONLY granted columns.
--
-- Revision publication, stated precisely, because two earlier drafts got
-- it wrong:
--   * listing_revisions HAS its own lifecycle: the public.revision_state
--     enum (draft, submitted, approved, publishing, published,
--     changes_requested, rejected) at 0001:263-272. It is simply not named
--     lifecycle_state, and it is not granted to anon -- so the column
--     exists, yet anon cannot select or filter on it (401, not 400).
--   * 0001:328-349 generates listing_revisions.published_ref_revision_id
--     as CASE WHEN revision_state = 'published' THEN revision_id END, and
--     listings.published_revision_id is an FK that can only point at a
--     non-NULL value of it. That is the anti-pointer-poisoning guarantee:
--     a listing's published pointer is unforgeable BY CONSTRUCTION.
--   * Therefore the anon-safe revision-publication test is the listing's
--     pointer, which is exactly what revision_public_read (0001:931) uses:
--         l.published_revision_id = <revision_id>
--         AND l.lifecycle_state  = 'published'
--     The buyer path below uses the same pair, so storage and the table
--     cannot disagree about what "published" means.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Path layout, defined here so policy and writer agree
-- ---------------------------------------------------------------------
-- A plain IMMUTABLE text parser. It reads nothing but its arguments, so it
-- needs no SECURITY DEFINER and no explicit grants: PUBLIC already holds
-- EXECUTE, exactly as for split_part. (The REVOKE/GRANT pair that mirrors
-- 0006's storage_path_org_id does NOT apply here -- that function is
-- SECURITY DEFINER and therefore needs scoped privileges. This one is not.)
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

-- ---------------------------------------------------------------------
-- 2. Scoped public read
-- ---------------------------------------------------------------------
-- Three ways a caller may read a derivative, in priority order:
--   (a) it belongs to a published revision of a published listing, AND the
--       media row lists this exact object in its derivative_paths array --
--       the buyer path. The pointer pair is the same one revision_public_read
--       uses; the array is written by the processing worker only after
--       processing succeeds, and both columns are granted to anon, unlike
--       revision_state / processing_status / moderation_status.
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
        JOIN public.listing_media m
          ON m.revision_id = r.revision_id
        WHERE r.revision_id = public.storage_path_segment(name, 2)
          AND l.published_revision_id = r.revision_id
          AND l.lifecycle_state = 'published'
          AND m.derivative_paths @> ARRAY[name]::text[]
      )
      OR public.storage_path_org_id(name) IN (SELECT public.current_user_org_ids())
      OR (SELECT public.current_platform_role()) IS NOT NULL
    )
  );

COMMIT;
