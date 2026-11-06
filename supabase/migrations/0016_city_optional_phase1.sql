-- ============================================================
-- 0016 - Remove `city` from the listing schema, PHASE 1 of 2
--
-- Why two phases. The deployed browser client still SELECTs `city`
-- directly (old chunk), so dropping the column in the same deploy that
-- ships the new readers would break live traffic. The safe order is:
--
--   PHASE 1 (this migration)
--       1. ALTER COLUMN city DROP NOT NULL
--       2. validate_revision_content - drop the city block
--       3. submit_revision_for_review - drop city from the
--          `required_fields` pre-check
--     Then DEPLOY the code that no longer reads or writes `city`.
--
--   PHASE 2 (0017) - drop the column and recreate the affected RPCs.
--
-- Consequence, stated plainly: the VALUES in listing_revisions.city are
-- lost when 0017 drops the column. area, town, county and country remain,
-- and area + county are the fields the product actually surfaces.
--
-- This migration does NOT drop the column.
--
-- Both function bodies below are restated from migration 0003 VERBATIM
-- (byte-identical except the city rules), because CREATE OR REPLACE cannot
-- edit one statement inside a function body.
-- ============================================================

-- -----
-- 1. Column becomes optional. Existing rows keep their city text;
--    nothing is backfilled or overwritten here.
-- -----
ALTER TABLE public.listing_revisions
  ALTER COLUMN city DROP NOT NULL;

-- -----
-- 2. validate_revision_content - city requirement removed.
--    Returns NULL when valid, else a typed {ok:false, reason_code}.
-- -----
CREATE OR REPLACE FUNCTION public.validate_revision_content(
  p_content jsonb,
  p_for_listing_create boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_amenities jsonb;
  v_item      text;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'content must be a JSON object.');
  END IF;

  -- ADR-014: the restricted set is NEVER owner-writable through any path.
  IF p_content ?| ARRAY['exact_address','latitude','longitude'] THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'restricted_fields_rejected',
      'message', 'Exact address and coordinates are restricted operational data and cannot be set through listing content.');
  END IF;

  IF p_for_listing_create THEN
    IF COALESCE(p_content->>'listing_kind', '') NOT IN ('sale','rent','shortlet') THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_listing_kind',
        'message', 'listing_kind must be sale, rent or shortlet (Phase 1 vocabulary).');
    END IF;
  END IF;

  IF COALESCE(btrim(COALESCE(p_content->>'title','')),'') = ''
     OR length(p_content->>'title') > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_title',
      'message', 'title is required (1-200 characters).');
  END IF;
  IF COALESCE(btrim(COALESCE(p_content->>'description','')),'') = ''
     OR length(p_content->>'description') > 20000 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_description',
      'message', 'description is required (1-20000 characters).');
  END IF;

  -- Provisional vocabularies (contracts §4): listing_kind frozen above from
  -- the seed-audit members; property_type stays free-text ≤ 50 until the
  -- vocabulary freeze; availability accepts only its verified member.
  IF COALESCE(btrim(COALESCE(p_content->>'property_type','')),'') = ''
     OR length(p_content->>'property_type') > 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_property_type',
      'message', 'property_type is required (1-50 characters).');
  END IF;
  IF COALESCE(p_content->>'availability','') <> 'available' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_availability',
      'message', 'availability must be "available" (the only verified member).');
  END IF;

  -- Money: decimal string, positive, sane ceiling (ADR-001: never a bare
  -- float; currency is explicit, the product default is applied by callers).
  IF p_content->>'price_amount' IS NULL
     OR p_content->>'price_amount' !~ '^\d{1,13}(\.\d{1,2})?$' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_price',
      'message', 'price_amount must be a positive decimal string with at most 2 decimals.');
  END IF;
  IF (p_content->>'price_amount')::numeric <= 0
     OR (p_content->>'price_amount')::numeric >= 100000000000000 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_price',
      'message', 'price_amount must be greater than 0.');
  END IF;
  IF COALESCE(p_content->>'price_currency','') !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_currency',
      'message', 'price_currency must be a 3-letter ISO 4217 code (product default: KES).');
  END IF;
  IF COALESCE(p_content->>'price_period','') NOT IN ('one_time','per_month','per_night') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_price_period',
      'message', 'price_period must be one_time, per_month or per_night (Phase 1 vocabulary).');
  END IF;

  -- Optional numerics: present and non-null ⇒ in range.
  IF p_content ? 'bedrooms' AND (p_content->>'bedrooms') IS NOT NULL THEN
    IF (p_content->>'bedrooms')::int < 0 OR (p_content->>'bedrooms')::int > 50 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_bedrooms',
        'message', 'bedrooms must be between 0 and 50.');
    END IF;
  END IF;
  IF p_content ? 'bathrooms' AND (p_content->>'bathrooms') IS NOT NULL THEN
    IF (p_content->>'bathrooms')::int < 0 OR (p_content->>'bathrooms')::int > 50 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_bathrooms',
        'message', 'bathrooms must be between 0 and 50.');
    END IF;
  END IF;
  IF p_content ? 'square_meters' AND (p_content->>'square_meters') IS NOT NULL THEN
    IF (p_content->>'square_meters')::numeric <= 0
       OR (p_content->>'square_meters')::numeric >= 1000000000 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_square_meters',
        'message', 'square_meters must be a positive number.');
    END IF;
  END IF;
  IF p_content ? 'lot_size_sqm' AND (p_content->>'lot_size_sqm') IS NOT NULL THEN
    IF (p_content->>'lot_size_sqm')::numeric <= 0
       OR (p_content->>'lot_size_sqm')::numeric >= 1000000000 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_lot_size',
        'message', 'lot_size_sqm must be a positive number.');
    END IF;
  END IF;
  IF p_content ? 'year_built' AND (p_content->>'year_built') IS NOT NULL THEN
    IF (p_content->>'year_built')::int < 1800 OR (p_content->>'year_built')::int > 2100 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_year_built',
        'message', 'year_built must be between 1800 and 2100.');
    END IF;
  END IF;
  IF p_content ? 'floor_number' AND (p_content->>'floor_number') IS NOT NULL THEN
    IF (p_content->>'floor_number')::int < -5 OR (p_content->>'floor_number')::int > 300 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_floor_number',
        'message', 'floor_number must be between -5 and 300.');
    END IF;
  END IF;
  IF p_content ? 'total_floors' AND (p_content->>'total_floors') IS NOT NULL THEN
    IF (p_content->>'total_floors')::int < 1 OR (p_content->>'total_floors')::int > 300 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_total_floors',
        'message', 'total_floors must be between 1 and 300.');
    END IF;
  END IF;

  -- Location: area-level only (ADR-014); country explicit (ADR-001).
  IF COALESCE(btrim(COALESCE(p_content->>'area','')),'') = ''
     OR length(p_content->>'area') > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_area',
      'message', 'area is required (1-200 characters, area-level only — never an exact address).');
  END IF;
  -- 0016: `city` is intentionally no longer validated or required. Phase 1 made
  -- the column optional; 0017 drops it. A payload carrying a city key is still
  -- accepted and stored NULL-tolerantly by the writer functions, so stale
  -- clients keep working until they are redeployed.
  IF p_content->>'town' IS NOT NULL AND length(p_content->>'town') > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_town',
      'message', 'town must be at most 100 characters.');
  END IF;
  IF p_content->>'county' IS NOT NULL AND length(p_content->>'county') > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_county',
      'message', 'county must be at most 100 characters.');
  END IF;
  IF COALESCE(btrim(COALESCE(p_content->>'country','')),'') = ''
     OR length(p_content->>'country') > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_country',
      'message', 'country is required (1-100 characters; product default: Kenya).');
  END IF;

  -- Amenities: array of short strings, bounded.
  IF p_content ? 'amenities'
     AND jsonb_typeof(p_content->'amenities') <> 'null' THEN
    IF jsonb_typeof(p_content->'amenities') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_amenities',
        'message', 'amenities must be an array of strings.');
    END IF;
    v_amenities := p_content->'amenities';
    IF jsonb_array_length(v_amenities) > 30 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_amenities',
        'message', 'amenities must hold at most 30 items.');
    END IF;
    FOR v_item IN SELECT jsonb_array_elements_text(v_amenities) LOOP
      IF btrim(v_item) = '' OR length(v_item) > 60 THEN
        RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_amenities',
          'message', 'Each amenity must be 1-60 characters.');
      END IF;
    END LOOP;
  END IF;

  IF p_content ? 'furnished'
     AND jsonb_typeof(p_content->'furnished') NOT IN ('boolean','null') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_furnished',
      'message', 'furnished must be true, false or null.');
  END IF;
  IF p_content->>'plot_dimensions' IS NOT NULL
     AND length(p_content->>'plot_dimensions') > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_plot_dimensions',
      'message', 'plot_dimensions must be at most 100 characters.');
  END IF;
  IF p_content->>'land_size_raw' IS NOT NULL
     AND length(p_content->>'land_size_raw') > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_land_size_raw',
      'message', 'land_size_raw must be at most 100 characters.');
  END IF;
  IF p_content->>'property_subtype' IS NOT NULL
     AND length(p_content->>'property_subtype') > 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_property_subtype',
      'message', 'property_subtype must be at most 50 characters.');
  END IF;

  RETURN NULL; -- valid
END $function$;

REVOKE ALL ON FUNCTION public.validate_revision_content(jsonb, boolean) FROM public;

COMMENT ON FUNCTION public.validate_revision_content(jsonb, boolean) IS
  'Shared validator for owner revision-content commands. Returns NULL when valid, else a typed {ok:false, reason_code} rejection. Rejects the ADR-014 restricted set outright.';

-- -----
-- 3. submit_revision_for_review - city removed from the required_fields
--    pre-check. Everything else identical to 0003.
-- -----
CREATE OR REPLACE FUNCTION public.submit_revision_for_review(
  p_revision_id     uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_revision    public.listing_revisions%ROWTYPE;
  v_case_id     uuid;
  v_case_ref    text;
  v_correlation text;
  v_attempts    integer := 0;
  v_desc_len    integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to submit a listing for review.');
  END IF;
  IF p_revision_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'revision_id is required.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- ---------- idempotent replay ----------
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT resource_id::uuid INTO v_case_id
      FROM public.audit_records
     WHERE action = 'listing_revision.submit'
       AND request_id = v_correlation
       AND outcome = 'accepted'
       AND actor_id = v_uid
     LIMIT 1;
    IF v_case_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
        'case_id', v_case_id, 'revision_id', p_revision_id);
    END IF;
  END IF;

  SELECT * INTO v_revision
    FROM public.listing_revisions r WHERE r.revision_id = p_revision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_found',
      'message', 'No such revision.');
  END IF;
  IF NOT public.caller_is_org_member(v_revision.organization_id) THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_revision.organization_id, 'listing_revision.submit',
      'listing_revision', p_revision_id::text, v_correlation,
      'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this revision''s organization.');
  END IF;
  IF v_revision.revision_state <> 'draft' THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_revision.organization_id, 'listing_revision.submit',
      'listing_revision', p_revision_id::text, v_correlation,
      'rejected', 'invalid_state');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_state',
      'message', 'Only a draft revision can be submitted for review.');
  END IF;

  -- ---------- transition: DRAFT → SUBMITTED ----------
  PERFORM set_config('luxonn.domain_command', 'on', true);

  UPDATE public.listing_revisions
     SET revision_state = 'submitted', updated_at = now()
   WHERE revision_id = p_revision_id;

  -- Mirror rule (contracts §3): only while unpublished — a correction
  -- draft's pipeline progress never surfaces on the Listing.
  UPDATE public.listings
     SET lifecycle_state = 'submitted', updated_at = now()
   WHERE listing_id = v_revision.listing_id
     AND published_revision_id IS NULL
     AND lifecycle_state IN ('draft', 'changes_requested', 'rejected');

  -- ---------- moderation case (ADR-013: human review first) ----------
  v_case_id := gen_random_uuid();
  LOOP
    v_attempts := v_attempts + 1;
    BEGIN
      INSERT INTO public.moderation_cases (
        case_id, case_kind, revision_id, listing_id, organization_id,
        case_state, reference, idempotency_key)
      VALUES (
        v_case_id, 'submission', p_revision_id, v_revision.listing_id,
        v_revision.organization_id, 'open',
        'MC-' || upper(substring(encode(gen_random_bytes(4), 'hex') FROM 1 FOR 8)),
        v_correlation);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 3 THEN RAISE; END IF;
      -- reference collision: retry with a new code
    END;
  END LOOP;
  SELECT reference INTO v_case_ref
    FROM public.moderation_cases WHERE case_id = v_case_id;

  -- ---------- deterministic pre-checks (ADR-013): validators only ----------
  v_desc_len := length(v_revision.description);
  INSERT INTO public.moderation_pre_checks
    (case_id, revision_id, organization_id, check_code, outcome, detail_code, checker_version)
  VALUES
    (v_case_id, p_revision_id, v_revision.organization_id,
     'required_fields',
     CASE WHEN btrim(v_revision.title) <> ''
               AND btrim(v_revision.description) <> ''
               AND btrim(v_revision.area) <> ''
          THEN 'pass' ELSE 'fail' END,
     NULL, '0003.1'),
    (v_case_id, p_revision_id, v_revision.organization_id,
     'price_sanity',
     CASE WHEN v_revision.price_amount > 0
               AND v_revision.price_amount < 100000000000000
          THEN 'pass' ELSE 'fail' END,
     NULL, '0003.1'),
    (v_case_id, p_revision_id, v_revision.organization_id,
     'description_depth',
     CASE WHEN v_desc_len >= 80 THEN 'pass'
          WHEN v_desc_len >= 30 THEN 'warn'
          ELSE 'fail' END,
     NULL, '0003.1'),
    (v_case_id, p_revision_id, v_revision.organization_id,
     'media_present',
     'warn',
     'media_attach_separate_surface',
     '0003.1');

  PERFORM set_config('luxonn.domain_command', 'off', true);

  -- ---------- audit + outbox ----------
  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'owner', v_uid, v_revision.organization_id, 'listing_revision.submit',
    'moderation_case', v_case_id::text, v_correlation,
    'accepted', 'submitted');

  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload)
  VALUES
    (v_revision.organization_id, 'listing_revision.submitted',
     'listing_revision', p_revision_id::text, v_correlation,
     jsonb_build_object(
       'revision_id', p_revision_id,
       'listing_id', v_revision.listing_id,
       'organization_id', v_revision.organization_id)),
    (v_revision.organization_id, 'moderation.case_opened',
     'moderation_case', v_case_id::text, v_correlation,
     jsonb_build_object(
       'case_id', v_case_id,
       'reference', v_case_ref,
       'revision_id', p_revision_id,
       'listing_id', v_revision.listing_id,
       'organization_id', v_revision.organization_id));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'revision_id', p_revision_id,
    'case_id', v_case_id,
    'case_reference', v_case_ref);
END $function$;

REVOKE ALL ON FUNCTION public.submit_revision_for_review(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_revision_for_review(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.submit_revision_for_review(uuid, text) IS
  'ADR-005 submit command: DRAFT→SUBMITTED with lifecycle mirror while unpublished, opens the ADR-013 submission moderation case, records deterministic pre-checks (validators only, never approving), audits, emits outbox events.';

-- -----
-- 4. Grants - unchanged from 0003.
-- -----
