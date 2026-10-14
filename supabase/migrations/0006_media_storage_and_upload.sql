-- =====================================================================
-- Migration: 0006_media_storage_and_upload.sql
-- Description: Media storage buckets, RLS policies, and listing media RPCs
-- ADRs: ADR-003, ADR-004, ADR-005, ADR-009, ADR-010, ADR-012, ADR-013
-- Contracts: contracts.md §5 (ListingMedia, MediaObservation, VisualDossier)
-- Security: security-data-boundaries.md § Media controls
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Storage Buckets (ADR-010, security doc Media control 1)
-- ---------------------------------------------------------------------

-- Private originals bucket: private, 25MB limit, strict MIME whitelist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-originals',
  'listing-originals',
  false,
  26214400, -- 25 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/avif',
    'video/mp4',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public derivatives bucket: public read for approved assets, 10MB limit
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-derivatives',
  'listing-derivatives',
  true,
  10485760, -- 10 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'video/mp4'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 2. Storage Path Parser Helper (Safe UUID Extraction)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.storage_path_org_id(p_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_segment text;
BEGIN
  v_segment := split_part(p_name, '/', 1);
  IF v_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_segment::uuid;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.storage_path_org_id(text) FROM public;
GRANT EXECUTE ON FUNCTION public.storage_path_org_id(text) TO authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. Storage RLS Policies on storage.objects
-- ---------------------------------------------------------------------

-- listing-originals: SELECT (org members + platform moderators/admins)
DROP POLICY IF EXISTS listing_originals_select ON storage.objects;
CREATE POLICY listing_originals_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'listing-originals'
    AND (
      public.storage_path_org_id(name) IN (SELECT public.current_user_org_ids())
      OR (SELECT public.current_platform_role()) IS NOT NULL
    )
  );

-- listing-originals: INSERT (org members for their own org prefix)
DROP POLICY IF EXISTS listing_originals_insert ON storage.objects;
CREATE POLICY listing_originals_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-originals'
    AND public.storage_path_org_id(name) IN (SELECT public.current_user_org_ids())
  );

-- listing-originals: UPDATE (org members for their own org prefix)
DROP POLICY IF EXISTS listing_originals_update ON storage.objects;
CREATE POLICY listing_originals_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'listing-originals'
    AND public.storage_path_org_id(name) IN (SELECT public.current_user_org_ids())
  )
  WITH CHECK (
    bucket_id = 'listing-originals'
    AND public.storage_path_org_id(name) IN (SELECT public.current_user_org_ids())
  );

-- listing-originals: DELETE (org members for their own org prefix)
DROP POLICY IF EXISTS listing_originals_delete ON storage.objects;
CREATE POLICY listing_originals_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-originals'
    AND public.storage_path_org_id(name) IN (SELECT public.current_user_org_ids())
  );

-- listing-derivatives: SELECT (public read for all)
DROP POLICY IF EXISTS listing_derivatives_public_select ON storage.objects;
CREATE POLICY listing_derivatives_public_select ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'listing-derivatives');

-- listing-derivatives: ALL (platform admins only; ingestion worker uses service role)
DROP POLICY IF EXISTS listing_derivatives_admin_manage ON storage.objects;
CREATE POLICY listing_derivatives_admin_manage ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'listing-derivatives'
    AND (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    bucket_id = 'listing-derivatives'
    AND (SELECT public.current_platform_role()) = 'admin'
  );

-- ---------------------------------------------------------------------
-- 4. Constraint Enhancement on listing_media
-- ---------------------------------------------------------------------

-- Make revision_id + position uniqueness DEFERRABLE to allow reordering
ALTER TABLE public.listing_media
  DROP CONSTRAINT IF EXISTS listing_media_revision_id_position_key;

ALTER TABLE public.listing_media
  ADD CONSTRAINT listing_media_revision_id_position_key
  UNIQUE (revision_id, position) DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- 5. Domain Commands: attach_listing_media
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.attach_listing_media(
  p_revision_id     uuid,
  p_original_path   text,
  p_kind            text,
  p_is_featured     boolean DEFAULT false,
  p_content_hash    text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_rev         public.listing_revisions%ROWTYPE;
  v_media_id    uuid;
  v_pos         integer;
  v_correlation text := coalesce(p_idempotency_key, gen_random_uuid()::text);
  v_expected_prefix text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to attach media to listings.');
  END IF;

  SELECT * INTO v_rev FROM public.listing_revisions WHERE revision_id = p_revision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_found',
      'message', 'Revision not found.');
  END IF;

  IF NOT public.caller_is_org_member(v_rev.organization_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this listing organization.');
  END IF;

  IF v_rev.revision_state <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'immutable_revision',
      'message', 'Media can only be attached to draft revisions.');
  END IF;

  IF p_kind NOT IN ('image', 'video') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_kind',
      'message', 'Media kind must be image or video.');
  END IF;

  -- Verify original path prefix matches org/revision pattern
  v_expected_prefix := v_rev.organization_id::text || '/' || p_revision_id::text || '/';
  IF NOT (p_original_path LIKE v_expected_prefix || '%') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_storage_path',
      'message', 'Original path must be within organization and revision directory.');
  END IF;

  -- Idempotency check: if audit record exists for this idempotency key, return prior media
  IF p_idempotency_key IS NOT NULL THEN
    SELECT (resource_id)::uuid INTO v_media_id
    FROM public.audit_records
    WHERE request_id = p_idempotency_key
      AND action = 'listing_media.attach'
      AND outcome = 'accepted'
    LIMIT 1;

    IF v_media_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'media_id', v_media_id,
        'revision_id', p_revision_id
      );
    END IF;
  END IF;

  v_media_id := gen_random_uuid();

  -- Compute next position
  SELECT coalesce(max(position), -1) + 1 INTO v_pos
  FROM public.listing_media
  WHERE revision_id = p_revision_id;

  -- If this is set as featured, clear existing featured flags on this revision
  IF p_is_featured IS TRUE THEN
    UPDATE public.listing_media
    SET is_featured = false
    WHERE revision_id = p_revision_id
      AND is_featured IS TRUE;
  END IF;

  -- Insert media row
  INSERT INTO public.listing_media (
    media_id,
    revision_id,
    organization_id,
    position,
    kind,
    is_featured,
    source,
    original_path,
    processing_status,
    moderation_status,
    content_hash
  ) VALUES (
    v_media_id,
    p_revision_id,
    v_rev.organization_id,
    v_pos,
    p_kind,
    coalesce(p_is_featured, false),
    'owner_upload',
    p_original_path,
    'pending',
    'unreviewed',
    p_content_hash
  );

  -- Audit record
  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code
  ) VALUES (
    'owner', v_uid, v_rev.organization_id, 'listing_media.attach',
    'listing_media', v_media_id::text, v_correlation, 'accepted', 'media_attached'
  );

  -- Outbox event for asynchronous media worker ingestion
  -- Note: outbox_events payload strictly excludes 'original_path' for buyer-safety
  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload
  ) VALUES (
    v_rev.organization_id,
    'media.uploaded',
    'listing_media',
    v_media_id::text,
    v_correlation,
    jsonb_build_object(
      'media_id', v_media_id,
      'revision_id', p_revision_id,
      'organization_id', v_rev.organization_id,
      'kind', p_kind,
      'position', v_pos,
      'media_source', 'owner_upload'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'media_id', v_media_id,
    'revision_id', p_revision_id,
    'position', v_pos,
    'is_featured', coalesce(p_is_featured, false),
    'kind', p_kind,
    'processing_status', 'pending',
    'moderation_status', 'unreviewed'
  );
END $function$;

REVOKE ALL ON FUNCTION public.attach_listing_media(uuid, text, text, boolean, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.attach_listing_media(uuid, text, text, boolean, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Domain Commands: delete_listing_media
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_listing_media(
  p_media_id        uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_media       public.listing_media%ROWTYPE;
  v_rev         public.listing_revisions%ROWTYPE;
  v_correlation text := coalesce(p_idempotency_key, gen_random_uuid()::text);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to delete listing media.');
  END IF;

  SELECT * INTO v_media FROM public.listing_media WHERE media_id = p_media_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'media_not_found',
      'message', 'Media record not found.');
  END IF;

  SELECT * INTO v_rev FROM public.listing_revisions WHERE revision_id = v_media.revision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_found',
      'message', 'Parent revision not found.');
  END IF;

  IF NOT public.caller_is_org_member(v_rev.organization_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this listing organization.');
  END IF;

  IF v_rev.revision_state <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'immutable_revision',
      'message', 'Media can only be deleted from draft revisions.');
  END IF;

  DELETE FROM public.listing_media WHERE media_id = p_media_id;

  -- Re-sequence positions cleanly
  WITH ordered AS (
    SELECT media_id, (ROW_NUMBER() OVER (ORDER BY position ASC) - 1)::integer AS new_pos
    FROM public.listing_media
    WHERE revision_id = v_media.revision_id
  )
  UPDATE public.listing_media lm
  SET position = ordered.new_pos
  FROM ordered
  WHERE lm.media_id = ordered.media_id;

  -- Audit record
  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code
  ) VALUES (
    'owner', v_uid, v_rev.organization_id, 'listing_media.delete',
    'listing_media', p_media_id::text, v_correlation, 'accepted', 'media_deleted'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'media_id', p_media_id,
    'revision_id', v_media.revision_id
  );
END $function$;

REVOKE ALL ON FUNCTION public.delete_listing_media(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_listing_media(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Domain Commands: reorder_listing_media
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reorder_listing_media(
  p_revision_id     uuid,
  p_media_ids       uuid[],
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_rev         public.listing_revisions%ROWTYPE;
  v_correlation text := coalesce(p_idempotency_key, gen_random_uuid()::text);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to reorder listing media.');
  END IF;

  SELECT * INTO v_rev FROM public.listing_revisions WHERE revision_id = p_revision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_found',
      'message', 'Revision not found.');
  END IF;

  IF NOT public.caller_is_org_member(v_rev.organization_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this listing organization.');
  END IF;

  IF v_rev.revision_state <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'immutable_revision',
      'message', 'Media can only be reordered on draft revisions.');
  END IF;

  -- Reorder based on array indices
  WITH mapping AS (
    SELECT unnest(p_media_ids) AS media_id, (generate_subscripts(p_media_ids, 1) - 1)::integer AS new_pos
  )
  UPDATE public.listing_media lm
  SET position = mapping.new_pos
  FROM mapping
  WHERE lm.revision_id = p_revision_id
    AND lm.media_id = mapping.media_id;

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code
  ) VALUES (
    'owner', v_uid, v_rev.organization_id, 'listing_media.reorder',
    'listing_revision', p_revision_id::text, v_correlation, 'accepted', 'media_reordered'
  );

  RETURN jsonb_build_object('ok', true, 'revision_id', p_revision_id);
END $function$;

REVOKE ALL ON FUNCTION public.reorder_listing_media(uuid, uuid[], text) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_listing_media(uuid, uuid[], text) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. Domain Commands: set_featured_media
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_featured_media(
  p_revision_id     uuid,
  p_media_id        uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_rev         public.listing_revisions%ROWTYPE;
  v_correlation text := coalesce(p_idempotency_key, gen_random_uuid()::text);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to set featured media.');
  END IF;

  SELECT * INTO v_rev FROM public.listing_revisions WHERE revision_id = p_revision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_found',
      'message', 'Revision not found.');
  END IF;

  IF NOT public.caller_is_org_member(v_rev.organization_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this listing organization.');
  END IF;

  IF v_rev.revision_state <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'immutable_revision',
      'message', 'Featured media can only be changed on draft revisions.');
  END IF;

  UPDATE public.listing_media
  SET is_featured = (media_id = p_media_id)
  WHERE revision_id = p_revision_id;

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code
  ) VALUES (
    'owner', v_uid, v_rev.organization_id, 'listing_media.featured_set',
    'listing_media', p_media_id::text, v_correlation, 'accepted', 'featured_updated'
  );

  RETURN jsonb_build_object('ok', true, 'featured_media_id', p_media_id);
END $function$;

REVOKE ALL ON FUNCTION public.set_featured_media(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_featured_media(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. Read Projection: get_revision_media
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_revision_media(
  p_revision_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_rev         public.listing_revisions%ROWTYPE;
  v_listing     public.listings%ROWTYPE;
  v_is_mod      boolean := public.caller_is_platform_moderator();
  v_is_owner    boolean := false;
  v_is_pub      boolean := false;
  v_items       jsonb;
BEGIN
  SELECT * INTO v_rev FROM public.listing_revisions WHERE revision_id = p_revision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_found',
      'message', 'Revision not found.');
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE listing_id = v_rev.listing_id;

  IF v_uid IS NOT NULL AND public.caller_is_org_member(v_rev.organization_id) THEN
    v_is_owner := true;
  END IF;

  IF v_listing.lifecycle_state = 'published' AND v_listing.published_revision_id = p_revision_id THEN
    v_is_pub := true;
  END IF;

  -- Access control: caller must be org member, moderator, or reading a published revision
  IF NOT (v_is_owner OR v_is_mod OR v_is_pub) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'Access denied.');
  END IF;

  -- Org owners & moderators see full pipeline details (original_path, statuses)
  -- Public buyers see only safe public derivatives
  IF v_is_owner OR v_is_mod THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'media_id', m.media_id,
      'revision_id', m.revision_id,
      'position', m.position,
      'kind', m.kind,
      'is_featured', m.is_featured,
      'source', m.source,
      'original_path', m.original_path,
      'derivative_paths', m.derivative_paths,
      'processing_status', m.processing_status,
      'moderation_status', m.moderation_status,
      'created_at', m.created_at
    ) ORDER BY m.position ASC), '[]'::jsonb)
    INTO v_items
    FROM public.listing_media m
    WHERE m.revision_id = p_revision_id;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'media_id', m.media_id,
      'revision_id', m.revision_id,
      'position', m.position,
      'kind', m.kind,
      'is_featured', m.is_featured,
      'derivative_paths', m.derivative_paths
    ) ORDER BY m.position ASC), '[]'::jsonb)
    INTO v_items
    FROM public.listing_media m
    WHERE m.revision_id = p_revision_id
      AND m.processing_status = 'processed'
      AND m.moderation_status = 'approved';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'revision_id', p_revision_id,
    'items', v_items
  );
END $function$;

REVOKE ALL ON FUNCTION public.get_revision_media(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_revision_media(uuid) TO authenticated, anon;

COMMIT;
