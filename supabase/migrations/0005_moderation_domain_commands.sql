-- ============================================================
-- 0005 — Moderator domain commands & read RPCs (ADR-005, ADR-013)
--
-- Migration 0001 created the schema, RLS policies, and column grants.
-- Migration 0003 added owner-side domain commands (submit opens cases).
-- Migration 0004 added owner-side read projections.
-- This migration completes Phase 1 Step 2.3: platform moderator review,
-- case inspection, and auditable decision domain commands.
--
-- Obligations honored (contracts §7/§11, ADR-005/013/014):
--   * authority resolves via platform_roles       — caller must hold
--     'moderator' or 'admin' role in public.platform_roles
--   * decision transitions                        — 'approve' publishes
--     the revision (atomic swap of published_revision_id);
--     'request_changes' and 'reject' update revision and listing states
--   * outbox events                               — transitions emit
--     listing.published, listing_revision.changes_requested,
--     listing_revision.rejected, or listing.withdrawn
--   * audit baseline                              — every decision writes
--     append-only audit_records with actor_type='moderator'
--   * zero-admin self-bootstrap                   — bootstrap_first_admin
--     allows the first admin to register iff platform_roles has 0 rows
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper: caller_is_platform_moderator
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caller_is_platform_moderator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.platform_roles pr
     WHERE pr.user_id = public.current_app_user_id()
       AND pr.role IN ('moderator', 'admin')
  )
$function$;

REVOKE ALL ON FUNCTION public.caller_is_platform_moderator() FROM public;
GRANT EXECUTE ON FUNCTION public.caller_is_platform_moderator() TO authenticated;

COMMENT ON FUNCTION public.caller_is_platform_moderator() IS
  'TRUE iff the authenticated caller holds moderator or admin platform role.';

-- ------------------------------------------------------------
-- 2. Bootstrap: bootstrap_first_admin
--    Allows setting up the very first platform admin when platform_roles
--    is completely empty. Once any role exists, this function rejects.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.current_app_user_id();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to bootstrap platform role.');
  END IF;

  SELECT count(*) INTO v_count FROM public.platform_roles;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'platform_roles_already_initialized',
      'message', 'Platform roles are already initialized. An administrator must assign roles.');
  END IF;

  INSERT INTO public.platform_roles (user_id, role)
  VALUES (v_uid, 'admin');

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'moderator', v_uid, NULL, 'platform_role.bootstrap_admin',
    'platform_roles', v_uid::text, gen_random_uuid()::text,
    'accepted', 'bootstrapped');

  RETURN jsonb_build_object('ok', true, 'role', 'admin', 'user_id', v_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.bootstrap_first_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated;

COMMENT ON FUNCTION public.bootstrap_first_admin() IS
  'One-time self-bootstrap for the first platform administrator when platform_roles is empty.';

-- ------------------------------------------------------------
-- 3. moderator_cases_summary — review queue index for staff.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moderator_cases_summary(
  p_case_state text DEFAULT 'open',
  p_case_kind  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid  uuid := public.current_app_user_id();
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to access the moderation queue.');
  END IF;

  IF NOT public.caller_is_platform_moderator() THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'Staff authorization required.');
  END IF;

  SELECT jsonb_agg(item ORDER BY item->>'opened_at' ASC)
    INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'case_id', c.case_id,
        'case_kind', c.case_kind,
        'case_state', c.case_state,
        'reference', c.reference,
        'opened_at', c.opened_at,
        'resolved_at', c.resolved_at,
        'listing_id', c.listing_id,
        'revision_id', c.revision_id,
        'organization_id', c.organization_id,
        'organization_name', o.display_name,
        'listing_kind', l.listing_kind,
        'lifecycle_state', l.lifecycle_state,
        'revision_title', r.title,
        'revision_state', r.revision_state,
        'price_amount', r.price_amount,
        'price_currency', r.price_currency,
        'city', r.city,
        'area', r.area,
        'pre_checks', COALESCE(
          (
            SELECT jsonb_agg(jsonb_build_object(
              'check_code', pc.check_code,
              'outcome', pc.outcome,
              'detail_code', pc.detail_code
            ))
            FROM public.moderation_pre_checks pc
            WHERE pc.case_id = c.case_id
          ),
          '[]'::jsonb
        )
      ) AS item
      FROM public.moderation_cases c
      JOIN public.owner_organizations o ON o.organization_id = c.organization_id
      JOIN public.listings l ON l.listing_id = c.listing_id
      LEFT JOIN public.listing_revisions r ON r.revision_id = c.revision_id
      WHERE (p_case_state IS NULL OR c.case_state = p_case_state)
        AND (p_case_kind IS NULL OR c.case_kind = p_case_kind)
    ) q;

  RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.moderator_cases_summary(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.moderator_cases_summary(text, text) TO authenticated;

COMMENT ON FUNCTION public.moderator_cases_summary(text, text) IS
  'Lists moderation cases for platform staff with prechecks and revision metadata.';

-- ------------------------------------------------------------
-- 4. moderator_case_detail — full case review inspection.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moderator_case_detail(
  p_case_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid     uuid := public.current_app_user_id();
  v_case    public.moderation_cases%ROWTYPE;
  v_org     public.owner_organizations%ROWTYPE;
  v_listing public.listings%ROWTYPE;
  v_rev     public.listing_revisions%ROWTYPE;
  v_checks  jsonb;
  v_history jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to access case detail.');
  END IF;

  IF NOT public.caller_is_platform_moderator() THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'Staff authorization required.');
  END IF;

  SELECT * INTO v_case FROM public.moderation_cases WHERE case_id = p_case_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'case_not_found',
      'message', 'Moderation case not found.');
  END IF;

  SELECT * INTO v_org FROM public.owner_organizations WHERE organization_id = v_case.organization_id;
  SELECT * INTO v_listing FROM public.listings WHERE listing_id = v_case.listing_id;
  IF v_case.revision_id IS NOT NULL THEN
    SELECT * INTO v_rev FROM public.listing_revisions WHERE revision_id = v_case.revision_id;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'check_id', pc.check_id,
    'check_code', pc.check_code,
    'outcome', pc.outcome,
    'detail_code', pc.detail_code,
    'checker_version', pc.checker_version,
    'ran_at', pc.ran_at
  ) ORDER BY pc.ran_at ASC)
  INTO v_checks
  FROM public.moderation_pre_checks pc
  WHERE pc.case_id = p_case_id;

  SELECT jsonb_agg(jsonb_build_object(
    'decision_id', md.decision_id,
    'decision', md.decision,
    'reason_code', md.reason_code,
    'note', md.note,
    'decided_by', md.decided_by,
    'decided_at', md.decided_at
  ) ORDER BY md.decided_at DESC)
  INTO v_history
  FROM public.moderation_decisions md
  WHERE md.case_id = p_case_id;

  RETURN jsonb_build_object(
    'ok', true,
    'case', jsonb_build_object(
      'case_id', v_case.case_id,
      'case_kind', v_case.case_kind,
      'case_state', v_case.case_state,
      'reference', v_case.reference,
      'report_category', v_case.report_category,
      'report_note', v_case.report_note,
      'opened_at', v_case.opened_at,
      'resolved_at', v_case.resolved_at
    ),
    'organization', jsonb_build_object(
      'organization_id', v_org.organization_id,
      'display_name', v_org.display_name,
      'kind', v_org.kind,
      'is_verified', v_org.is_verified
    ),
    'listing', jsonb_build_object(
      'listing_id', v_listing.listing_id,
      'listing_kind', v_listing.listing_kind,
      'lifecycle_state', v_listing.lifecycle_state,
      'published_revision_id', v_listing.published_revision_id
    ),
    'revision', CASE WHEN v_rev.revision_id IS NOT NULL THEN jsonb_build_object(
      'revision_id', v_rev.revision_id,
      'base_revision_id', v_rev.base_revision_id,
      'revision_state', v_rev.revision_state,
      'title', v_rev.title,
      'description', v_rev.description,
      'property_type', v_rev.property_type,
      'property_subtype', v_rev.property_subtype,
      'availability', v_rev.availability,
      'price_amount', v_rev.price_amount,
      'price_currency', v_rev.price_currency,
      'price_period', v_rev.price_period,
      'bedrooms', v_rev.bedrooms,
      'bathrooms', v_rev.bathrooms,
      'square_meters', v_rev.square_meters,
      'lot_size_sqm', v_rev.lot_size_sqm,
      'year_built', v_rev.year_built,
      'floor_number', v_rev.floor_number,
      'total_floors', v_rev.total_floors,
      'plot_dimensions', v_rev.plot_dimensions,
      'land_size_raw', v_rev.land_size_raw,
      'area', v_rev.area,
      'city', v_rev.city,
      'town', v_rev.town,
      'county', v_rev.county,
      'country', v_rev.country,
      'amenities', v_rev.amenities,
      'furnished', v_rev.furnished,
      'created_at', v_rev.created_at,
      'published_at', v_rev.published_at
    ) ELSE NULL END,
    'pre_checks', COALESCE(v_checks, '[]'::jsonb),
    'decision_history', COALESCE(v_history, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.moderator_case_detail(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.moderator_case_detail(uuid) TO authenticated;

COMMENT ON FUNCTION public.moderator_case_detail(uuid) IS
  'Returns full moderation case detail, revision content, pre-checks, and decision history.';

-- ------------------------------------------------------------
-- 5. decide_moderation_case — auditable moderation decision command.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_moderation_case(
  p_case_id         uuid,
  p_decision        text,
  p_reason_code     text,
  p_note            text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_case        public.moderation_cases%ROWTYPE;
  v_rev         public.listing_revisions%ROWTYPE;
  v_listing     public.listings%ROWTYPE;
  v_decision_id uuid;
  v_correlation text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to record a moderation decision.');
  END IF;

  IF NOT public.caller_is_platform_moderator() THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'Staff authorization required.');
  END IF;

  IF p_case_id IS NULL OR p_decision IS NULL OR btrim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'case_id, decision, and reason_code are required.');
  END IF;

  IF p_decision NOT IN ('approve', 'request_changes', 'reject', 'dismiss', 'takedown') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_decision',
      'message', 'Decision must be one of: approve, request_changes, reject, dismiss, takedown.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- Idempotent replay check
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT resource_id::uuid INTO v_decision_id
      FROM public.audit_records
     WHERE action LIKE 'moderation.%'
       AND request_id = v_correlation
       AND outcome = 'accepted'
       AND actor_id = v_uid
     LIMIT 1;
    IF v_decision_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
        'decision_id', v_decision_id, 'case_id', p_case_id);
    END IF;
  END IF;

  SELECT * INTO v_case FROM public.moderation_cases WHERE case_id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'case_not_found',
      'message', 'Moderation case does not exist.');
  END IF;

  IF v_case.case_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'case_already_resolved',
      'message', 'This case has already been resolved.');
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE listing_id = v_case.listing_id FOR UPDATE;
  IF v_case.revision_id IS NOT NULL THEN
    SELECT * INTO v_rev FROM public.listing_revisions WHERE revision_id = v_case.revision_id FOR UPDATE;
  END IF;

  v_decision_id := gen_random_uuid();

  -- ============================================================
  -- Decision Branching
  -- ============================================================
  IF p_decision = 'approve' THEN
    IF v_case.case_kind <> 'submission' OR v_rev.revision_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_decision_for_case',
        'message', 'Approve is only valid for submission cases with an active revision.');
    END IF;
    IF v_rev.revision_state <> 'submitted' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_revision_state',
        'message', 'Only submitted revisions can be approved.');
    END IF;

    PERFORM set_config('luxonn.domain_command', 'on', true);

    -- 1. Advance revision to published (atomic swap directly per contracts §11)
    UPDATE public.listing_revisions
       SET revision_state = 'published',
           published_at = now(),
           updated_at = now()
     WHERE revision_id = v_rev.revision_id;

    -- 2. Atomic swap of listing pointer & lifecycle
    UPDATE public.listings
       SET published_revision_id = v_rev.revision_id,
           lifecycle_state = 'published',
           updated_at = now()
     WHERE listing_id = v_listing.listing_id;

    -- 3. Resolve case
    UPDATE public.moderation_cases
       SET case_state = 'resolved',
           resolved_at = now()
     WHERE case_id = p_case_id;

    -- 4. Record decision
    INSERT INTO public.moderation_decisions (
      decision_id, case_id, revision_id, organization_id, decision,
      decided_by, decided_at, reason_code, note
    ) VALUES (
      v_decision_id, p_case_id, v_rev.revision_id, v_case.organization_id, 'approve',
      v_uid, now(), p_reason_code, p_note
    );

    PERFORM set_config('luxonn.domain_command', 'off', true);

    -- 5. Audit record & outbox event
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES (
      'moderator', v_uid, v_case.organization_id, 'listing_revision.approve',
      'moderation_decision', v_decision_id::text, v_correlation,
      'accepted', p_reason_code);

    INSERT INTO public.outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id,
      correlation_id, payload)
    VALUES (
      v_case.organization_id, 'listing.published',
      'listing', v_listing.listing_id::text, v_correlation,
      jsonb_build_object(
        'listing_id', v_listing.listing_id,
        'revision_id', v_rev.revision_id,
        'organization_id', v_case.organization_id,
        'published_at', now()
      )
    );

  ELSIF p_decision = 'request_changes' THEN
    IF v_case.case_kind <> 'submission' OR v_rev.revision_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_decision_for_case',
        'message', 'Request changes is only valid for submission cases.');
    END IF;
    IF v_rev.revision_state <> 'submitted' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_revision_state',
        'message', 'Only submitted revisions can have changes requested.');
    END IF;

    PERFORM set_config('luxonn.domain_command', 'on', true);

    UPDATE public.listing_revisions
       SET revision_state = 'changes_requested',
           updated_at = now()
     WHERE revision_id = v_rev.revision_id;

    IF v_listing.published_revision_id IS NULL THEN
      UPDATE public.listings
         SET lifecycle_state = 'changes_requested',
             updated_at = now()
       WHERE listing_id = v_listing.listing_id;
    END IF;

    UPDATE public.moderation_cases
       SET case_state = 'resolved',
           resolved_at = now()
     WHERE case_id = p_case_id;

    INSERT INTO public.moderation_decisions (
      decision_id, case_id, revision_id, organization_id, decision,
      decided_by, decided_at, reason_code, note
    ) VALUES (
      v_decision_id, p_case_id, v_rev.revision_id, v_case.organization_id, 'request_changes',
      v_uid, now(), p_reason_code, p_note
    );

    PERFORM set_config('luxonn.domain_command', 'off', true);

    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES (
      'moderator', v_uid, v_case.organization_id, 'listing_revision.request_changes',
      'moderation_decision', v_decision_id::text, v_correlation,
      'accepted', p_reason_code);

    INSERT INTO public.outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id,
      correlation_id, payload)
    VALUES (
      v_case.organization_id, 'listing_revision.changes_requested',
      'listing_revision', v_rev.revision_id::text, v_correlation,
      jsonb_build_object(
        'listing_id', v_listing.listing_id,
        'revision_id', v_rev.revision_id,
        'organization_id', v_case.organization_id,
        'reason_code', p_reason_code,
        'note', p_note
      )
    );

  ELSIF p_decision = 'reject' THEN
    IF v_case.case_kind <> 'submission' OR v_rev.revision_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_decision_for_case',
        'message', 'Reject is only valid for submission cases.');
    END IF;
    IF v_rev.revision_state <> 'submitted' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_revision_state',
        'message', 'Only submitted revisions can be rejected.');
    END IF;

    PERFORM set_config('luxonn.domain_command', 'on', true);

    UPDATE public.listing_revisions
       SET revision_state = 'rejected',
           updated_at = now()
     WHERE revision_id = v_rev.revision_id;

    IF v_listing.published_revision_id IS NULL THEN
      UPDATE public.listings
         SET lifecycle_state = 'rejected',
             updated_at = now()
       WHERE listing_id = v_listing.listing_id;
    END IF;

    UPDATE public.moderation_cases
       SET case_state = 'resolved',
           resolved_at = now()
     WHERE case_id = p_case_id;

    INSERT INTO public.moderation_decisions (
      decision_id, case_id, revision_id, organization_id, decision,
      decided_by, decided_at, reason_code, note
    ) VALUES (
      v_decision_id, p_case_id, v_rev.revision_id, v_case.organization_id, 'reject',
      v_uid, now(), p_reason_code, p_note
    );

    PERFORM set_config('luxonn.domain_command', 'off', true);

    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES (
      'moderator', v_uid, v_case.organization_id, 'listing_revision.reject',
      'moderation_decision', v_decision_id::text, v_correlation,
      'accepted', p_reason_code);

    INSERT INTO public.outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id,
      correlation_id, payload)
    VALUES (
      v_case.organization_id, 'listing_revision.rejected',
      'listing_revision', v_rev.revision_id::text, v_correlation,
      jsonb_build_object(
        'listing_id', v_listing.listing_id,
        'revision_id', v_rev.revision_id,
        'organization_id', v_case.organization_id,
        'reason_code', p_reason_code,
        'note', p_note
      )
    );

  ELSIF p_decision = 'dismiss' THEN
    IF v_case.case_kind NOT IN ('buyer_report', 'staff_initiated') THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_decision_for_case',
        'message', 'Dismiss is only valid for buyer reports or staff-initiated cases.');
    END IF;

    UPDATE public.moderation_cases
       SET case_state = 'resolved',
           resolved_at = now()
     WHERE case_id = p_case_id;

    INSERT INTO public.moderation_decisions (
      decision_id, case_id, revision_id, organization_id, decision,
      decided_by, decided_at, reason_code, note
    ) VALUES (
      v_decision_id, p_case_id, v_case.revision_id, v_case.organization_id, 'dismiss',
      v_uid, now(), p_reason_code, p_note
    );

    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES (
      'moderator', v_uid, v_case.organization_id, 'moderation_case.dismiss',
      'moderation_decision', v_decision_id::text, v_correlation,
      'accepted', p_reason_code);

  ELSIF p_decision = 'takedown' THEN
    IF v_listing.lifecycle_state <> 'published' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_not_published',
        'message', 'Takedown is only valid for currently published listings.');
    END IF;

    PERFORM set_config('luxonn.domain_command', 'on', true);

    UPDATE public.listings
       SET lifecycle_state = 'withdrawn',
           withdrawn_at = now(),
           updated_at = now()
     WHERE listing_id = v_listing.listing_id;

    UPDATE public.moderation_cases
       SET case_state = 'resolved',
           resolved_at = now()
     WHERE case_id = p_case_id;

    INSERT INTO public.moderation_decisions (
      decision_id, case_id, revision_id, organization_id, decision,
      decided_by, decided_at, reason_code, note
    ) VALUES (
      v_decision_id, p_case_id, v_case.revision_id, v_case.organization_id, 'takedown',
      v_uid, now(), p_reason_code, p_note
    );

    PERFORM set_config('luxonn.domain_command', 'off', true);

    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES (
      'moderator', v_uid, v_case.organization_id, 'listing.takedown',
      'moderation_decision', v_decision_id::text, v_correlation,
      'accepted', p_reason_code);

    INSERT INTO public.outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id,
      correlation_id, payload)
    VALUES (
      v_case.organization_id, 'listing.withdrawn',
      'listing', v_listing.listing_id::text, v_correlation,
      jsonb_build_object(
        'listing_id', v_listing.listing_id,
        'organization_id', v_case.organization_id,
        'reason', 'moderator_takedown',
        'reason_code', p_reason_code,
        'withdrawn_at', now()
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'decision_id', v_decision_id,
    'case_id', p_case_id,
    'decision', p_decision,
    'listing_id', v_listing.listing_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.decide_moderation_case(uuid, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.decide_moderation_case(uuid, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.decide_moderation_case(uuid, text, text, text, text) IS
  'Domain command for platform staff to decide moderation cases (approve, request_changes, reject, dismiss, takedown).';
