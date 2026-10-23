-- ============================================================
-- 0014 — owner_latest_revision_state RPC
--
-- Lightweight SECURITY DEFINER read that returns just the latest
-- revision's id, state, and created_at for a given listing the
-- caller's org owns. Used by the edit/detail pages as a fast
-- pre-check before loading the full revision via
-- owner_listing_revision (migration 0004).
--
-- Fixes: the edit and detail pages were querying listing_revisions
-- directly for revision_state and created_at — columns excluded
-- from the column-level SELECT grant (migration 0001). PostgREST
-- returned 403 (permission denied for table listing_revisions).
-- ============================================================

CREATE OR REPLACE FUNCTION public.owner_latest_revision_state(
  p_listing_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid  uuid := public.current_app_user_id();
  v_org  uuid;
  v_rev  record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason_code', 'not_authenticated',
      'message', 'Sign in to view listing revisions.'
    );
  END IF;

  SELECT l.organization_id INTO v_org
  FROM public.listings l
  WHERE l.listing_id = p_listing_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason_code', 'not_found',
      'message', 'Listing not found.'
    );
  END IF;

  IF NOT public.caller_is_org_member(v_org) THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id,
      action, resource_type, resource_id,
      request_id, outcome, reason_code
    ) VALUES (
      'owner', v_uid, v_org,
      'revision.read.latest_state', 'listing', p_listing_id::text,
      gen_random_uuid()::text, 'rejected', 'not_authorized'
    );
    RETURN jsonb_build_object(
      'ok', false,
      'reason_code', 'not_authorized',
      'message', 'You are not a member of the organization that owns this listing.'
    );
  END IF;

  SELECT lr.revision_id, lr.revision_state, lr.created_at
  INTO v_rev
  FROM public.listing_revisions lr
  WHERE lr.listing_id = p_listing_id
  ORDER BY lr.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason_code', 'no_revision',
      'message', 'This listing has no revisions.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'revision_id', v_rev.revision_id,
    'revision_state', v_rev.revision_state,
    'created_at', v_rev.created_at
  );
END $function$;

REVOKE ALL ON FUNCTION public.owner_latest_revision_state(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_latest_revision_state(uuid) TO authenticated;

COMMENT ON FUNCTION public.owner_latest_revision_state(uuid) IS
  'Lightweight owner read: latest revision state for the given listing. Returns {ok, revision_id, revision_state, created_at} or a typed rejection.';
