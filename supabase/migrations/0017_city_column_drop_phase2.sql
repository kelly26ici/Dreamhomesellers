-- ============================================================
-- 0017 - Remove `city` from the listing schema, PHASE 2 of 2
--
-- WARNING: this migration is IRREVERSIBLE for data. Every value in
-- public.listing_revisions.city is DESTROYED when the column is dropped.
-- There is no archive table and no backfill, by explicit request.
--
-- Order matters. Each function below is recreated WITHOUT its city reference
-- BEFORE the column is dropped. A PL/pgSQL body only plans its SQL at
-- execution time, so a function that still reads city would compile fine here
-- and then fail at runtime once the column is gone.
--
-- Every function is recreated VERBATIM from its latest definition, with ONLY
-- the city reference removed. owner_listings_summary comes from 0013 (its
-- latest definition), not 0004.
--
-- Deploy order (strict):
--   1. 0016 applied (city optional, no longer required)
--   2. code deployed that no longer reads/writes city
--   3. apply this migration
-- ============================================================

-- -----
-- create_listing_draft - recreated from 0003_owner_domain_commands.sql L397-L560; city reference removed.
-- -----
CREATE OR REPLACE FUNCTION public.create_listing_draft(
  p_organization_id uuid,
  p_content         jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_rejection   jsonb;
  v_property_id uuid;
  v_listing_id  uuid;
  v_revision_id uuid;
  v_correlation text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to create a listing.');
  END IF;
  IF p_organization_id IS NULL OR p_content IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'organization_id and content are required.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- ---------- idempotent replay ----------
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT resource_id::uuid INTO v_listing_id
      FROM public.audit_records
     WHERE action = 'listing.create'
       AND request_id = v_correlation
       AND outcome = 'accepted'
       AND actor_id = v_uid
     LIMIT 1;
    IF v_listing_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
        'listing_id', v_listing_id);
    END IF;
  END IF;

  -- ---------- ADR-012 authority ----------
  IF NOT public.caller_is_org_member(p_organization_id) THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, p_organization_id, 'listing.create',
      'listing', p_organization_id::text, v_correlation,
      'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this organization.');
  END IF;

  -- ---------- shared content validation ----------
  v_rejection := public.validate_revision_content(p_content, true);
  IF v_rejection IS NOT NULL THEN
    RETURN v_rejection;
  END IF;

  -- ---------- create (product defaults: KES / Kenya, applied server-side
  -- when absent — ADR-001 product defaults, never schema constants) ----------
  v_property_id := gen_random_uuid();
  v_listing_id  := gen_random_uuid();
  v_revision_id := gen_random_uuid();

  INSERT INTO public.properties_lux (
    property_id, organization_id, exact_address, latitude, longitude,
    verification_status, created_via)
  VALUES (
    v_property_id, p_organization_id, NULL, NULL, NULL,
    'unverified', 'owner');

  INSERT INTO public.listings (
    listing_id, property_id, organization_id, listing_kind,
    lifecycle_state, created_via)
  VALUES (
    v_listing_id, v_property_id, p_organization_id,
    p_content->>'listing_kind', 'draft', 'owner');

  INSERT INTO public.listing_revisions (
    revision_id, listing_id, organization_id, revision_state,
    title, description, property_type, property_subtype, availability,
    price_amount, price_currency, price_period,
    bedrooms, bathrooms, square_meters, lot_size_sqm,
    year_built, floor_number, total_floors,
    plot_dimensions, land_size_raw,
    area, town, county, country,
    amenities, furnished, created_by, created_via)
  VALUES (
    v_revision_id, v_listing_id, p_organization_id, 'draft',
    btrim(p_content->>'title'),
    btrim(p_content->>'description'),
    btrim(p_content->>'property_type'),
    NULLIF(btrim(COALESCE(p_content->>'property_subtype','')), ''),
    'available',
    (p_content->>'price_amount')::numeric,
    COALESCE(p_content->>'price_currency', 'KES'),
    p_content->>'price_period',
    (p_content->>'bedrooms')::int,
    (p_content->>'bathrooms')::int,
    (p_content->>'square_meters')::double precision,
    (p_content->>'lot_size_sqm')::double precision,
    (p_content->>'year_built')::int,
    (p_content->>'floor_number')::int,
    (p_content->>'total_floors')::int,
    NULLIF(btrim(COALESCE(p_content->>'plot_dimensions','')), ''),
    NULLIF(btrim(COALESCE(p_content->>'land_size_raw','')), ''),
    btrim(p_content->>'area'),
    NULLIF(btrim(COALESCE(p_content->>'town','')), ''),
    NULLIF(btrim(COALESCE(p_content->>'county','')), ''),
    COALESCE(btrim(p_content->>'country'), 'Kenya'),
    COALESCE(
      (SELECT array_agg(btrim(value))
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p_content->'amenities') = 'array'
                THEN p_content->'amenities' ELSE '[]'::jsonb END)),
      '{}'),
    CASE WHEN jsonb_typeof(p_content->'furnished') = 'boolean'
         THEN (p_content->'furnished')::text::boolean END,
    v_uid, 'owner');

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'owner', v_uid, p_organization_id, 'listing.create',
    'listing', v_listing_id::text, v_correlation, 'accepted', 'draft_created');

  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload)
  VALUES (
    p_organization_id, 'listing.draft_created', 'listing', v_listing_id::text,
    v_correlation,
    jsonb_build_object(
      'listing_id', v_listing_id,
      'revision_id', v_revision_id,
      'organization_id', p_organization_id,
      'listing_kind', p_content->>'listing_kind'));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'listing_id', v_listing_id,
    'revision_id', v_revision_id);
END $function$;

REVOKE ALL ON FUNCTION public.create_listing_draft(uuid, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_listing_draft(uuid, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.create_listing_draft(uuid, jsonb, text) IS
  'ADR-005/012 domain command: Property + Listing + first DRAFT revision atomically. Rejects the ADR-014 restricted set, stamps created_by server-side, applies KES/Kenya product defaults (ADR-001), audits and emits a buyer-safe outbox event.';

-- ------------------------------------------------------------
-- 3. create_revision_draft — a NEW draft revision on an EXISTING
--    listing. Two uses (contracts §11 correction rule): correcting a
--    published listing (base = its published revision, resolved
--    server-side) and continuing after CHANGES_REQUESTED / REJECTED
--    (base = NULL before first publication — the base_published_
--    same_listing_fk constraint permits a NULL base pre-publication).
-- ------------------------------------------------------------

-- -----
-- create_revision_draft - recreated from 0003_owner_domain_commands.sql L561-L735; city reference removed.
-- -----
CREATE OR REPLACE FUNCTION public.create_revision_draft(
  p_listing_id      uuid,
  p_content         jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_rejection   jsonb;
  v_listing     public.listings%ROWTYPE;
  v_revision_id uuid;
  v_base_id     uuid;
  v_correlation text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to create a revision.');
  END IF;
  IF p_listing_id IS NULL OR p_content IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'listing_id and content are required.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- ---------- idempotent replay ----------
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT resource_id::uuid INTO v_revision_id
      FROM public.audit_records
     WHERE action = 'listing_revision.create'
       AND request_id = v_correlation
       AND outcome = 'accepted'
       AND actor_id = v_uid
     LIMIT 1;
    IF v_revision_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
        'revision_id', v_revision_id);
    END IF;
  END IF;

  -- ---------- listing + authority ----------
  SELECT * INTO v_listing FROM public.listings l WHERE l.listing_id = p_listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_not_found',
      'message', 'No such listing.');
  END IF;
  IF NOT public.caller_is_org_member(v_listing.organization_id) THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_listing.organization_id, 'listing_revision.create',
      'listing', p_listing_id::text, v_correlation, 'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this listing''s organization.');
  END IF;

  -- CLOSED is terminal (contracts §3): relisting is a NEW Listing on the
  -- same Property — never a new revision here.
  IF v_listing.lifecycle_state = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_closed',
      'message', 'This listing is closed; relist by creating a new listing on the same property.');
  END IF;

  -- ---------- shared content validation ----------
  v_rejection := public.validate_revision_content(p_content, false);
  IF v_rejection IS NOT NULL THEN
    RETURN v_rejection;
  END IF;

  -- Correction lineage (contracts §11): base = the published revision
  -- when one exists; NULL before first publication. The composite
  -- base_published_same_listing_fk constraint enforces same-listing too.
  v_base_id     := v_listing.published_revision_id;
  v_revision_id := gen_random_uuid();

  INSERT INTO public.listing_revisions (
    revision_id, listing_id, organization_id, base_revision_id, revision_state,
    title, description, property_type, property_subtype, availability,
    price_amount, price_currency, price_period,
    bedrooms, bathrooms, square_meters, lot_size_sqm,
    year_built, floor_number, total_floors,
    plot_dimensions, land_size_raw,
    area, town, county, country,
    amenities, furnished, created_by, created_via)
  VALUES (
    v_revision_id, p_listing_id, v_listing.organization_id, v_base_id, 'draft',
    btrim(p_content->>'title'),
    btrim(p_content->>'description'),
    btrim(p_content->>'property_type'),
    NULLIF(btrim(COALESCE(p_content->>'property_subtype','')), ''),
    'available',
    (p_content->>'price_amount')::numeric,
    COALESCE(p_content->>'price_currency', 'KES'),
    p_content->>'price_period',
    (p_content->>'bedrooms')::int,
    (p_content->>'bathrooms')::int,
    (p_content->>'square_meters')::double precision,
    (p_content->>'lot_size_sqm')::double precision,
    (p_content->>'year_built')::int,
    (p_content->>'floor_number')::int,
    (p_content->>'total_floors')::int,
    NULLIF(btrim(COALESCE(p_content->>'plot_dimensions','')), ''),
    NULLIF(btrim(COALESCE(p_content->>'land_size_raw','')), ''),
    btrim(p_content->>'area'),
    NULLIF(btrim(COALESCE(p_content->>'town','')), ''),
    NULLIF(btrim(COALESCE(p_content->>'county','')), ''),
    COALESCE(btrim(p_content->>'country'), 'Kenya'),
    COALESCE(
      (SELECT array_agg(btrim(value))
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p_content->'amenities') = 'array'
                THEN p_content->'amenities' ELSE '[]'::jsonb END)),
      '{}'),
    CASE WHEN jsonb_typeof(p_content->'furnished') = 'boolean'
         THEN (p_content->'furnished')::text::boolean END,
    v_uid, 'owner');

  -- Mirror rule (contracts §3): lifecycle_state mirrors the working
  -- revision before first publication. A guard-triggered transition, so
  -- the GUC is set locally; the update itself is narrowed by the WHERE
  -- clause so the GUC never widens what this command may change.
  PERFORM set_config('luxonn.domain_command', 'on', true);
  IF v_listing.published_revision_id IS NULL
     AND v_listing.lifecycle_state IN ('changes_requested', 'rejected') THEN
    UPDATE public.listings
       SET lifecycle_state = 'draft', updated_at = now()
     WHERE listing_id = p_listing_id
       AND published_revision_id IS NULL
       AND lifecycle_state IN ('draft', 'changes_requested', 'rejected');
  END IF;
  PERFORM set_config('luxonn.domain_command', 'off', true);

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'owner', v_uid, v_listing.organization_id, 'listing_revision.create',
    'listing_revision', v_revision_id::text, v_correlation,
    'accepted', 'draft_created');

  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload)
  VALUES (
    v_listing.organization_id, 'listing_revision.draft_created',
    'listing_revision', v_revision_id::text,
    v_correlation,
    jsonb_build_object(
      'revision_id', v_revision_id,
      'listing_id', p_listing_id,
      'organization_id', v_listing.organization_id));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'revision_id', v_revision_id);
END $function$;

REVOKE ALL ON FUNCTION public.create_revision_draft(uuid, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_revision_draft(uuid, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.create_revision_draft(uuid, jsonb, text) IS
  'ADR-005 correction/continuation command: new DRAFT revision on an existing listing; base_revision_id resolves server-side to the published revision when one exists. Audited, idempotent, outbox-emitting.';

-- ------------------------------------------------------------
-- 4. update_draft_revision — full-content replace on a revision still in
--    'draft'. Every other state is frozen or terminal: approved /
--    publishing / published revisions are immutable history (the guard
--    backs this too), and CHANGES_REQUESTED / REJECTED are terminal for
--    that artifact — the owner continues on a new draft (command 3).
-- ------------------------------------------------------------

-- -----
-- update_draft_revision - recreated from 0003_owner_domain_commands.sql L736-L858; city reference removed.
-- -----
CREATE OR REPLACE FUNCTION public.update_draft_revision(
  p_revision_id     uuid,
  p_content         jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_rejection   jsonb;
  v_revision    public.listing_revisions%ROWTYPE;
  v_correlation text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to edit a draft.');
  END IF;
  IF p_revision_id IS NULL OR p_content IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'revision_id and content are required.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

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
    VALUES ('owner', v_uid, v_revision.organization_id, 'listing_revision.update',
      'listing_revision', p_revision_id::text, v_correlation,
      'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this revision''s organization.');
  END IF;
  IF v_revision.revision_state <> 'draft' THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_revision.organization_id, 'listing_revision.update',
      'listing_revision', p_revision_id::text, v_correlation,
      'rejected', 'revision_not_editable');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_editable',
      'message', 'Only draft revisions are editable; continue on a new draft for submitted or reviewed revisions.');
  END IF;

  -- ---------- shared content validation ----------
  v_rejection := public.validate_revision_content(p_content, false);
  IF v_rejection IS NOT NULL THEN
    RETURN v_rejection;
  END IF;

  UPDATE public.listing_revisions SET
    title            = btrim(p_content->>'title'),
    description      = btrim(p_content->>'description'),
    property_type    = btrim(p_content->>'property_type'),
    property_subtype = NULLIF(btrim(COALESCE(p_content->>'property_subtype','')), ''),
    availability     = 'available',
    price_amount     = (p_content->>'price_amount')::numeric,
    price_currency   = COALESCE(p_content->>'price_currency', price_currency),
    price_period     = p_content->>'price_period',
    bedrooms         = (p_content->>'bedrooms')::int,
    bathrooms        = (p_content->>'bathrooms')::int,
    square_meters    = (p_content->>'square_meters')::double precision,
    lot_size_sqm     = (p_content->>'lot_size_sqm')::double precision,
    year_built       = (p_content->>'year_built')::int,
    floor_number     = (p_content->>'floor_number')::int,
    total_floors     = (p_content->>'total_floors')::int,
    plot_dimensions  = NULLIF(btrim(COALESCE(p_content->>'plot_dimensions','')), ''),
    land_size_raw    = NULLIF(btrim(COALESCE(p_content->>'land_size_raw','')), ''),
    area             = btrim(p_content->>'area'),
    town             = NULLIF(btrim(COALESCE(p_content->>'town','')), ''),
    county           = NULLIF(btrim(COALESCE(p_content->>'county','')), ''),
    country          = COALESCE(btrim(p_content->>'country'), country),
    amenities        = COALESCE(
      (SELECT array_agg(btrim(value))
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p_content->'amenities') = 'array'
                THEN p_content->'amenities' ELSE '[]'::jsonb END)),
      '{}'),
    furnished        = CASE WHEN jsonb_typeof(p_content->'furnished') = 'boolean'
                            THEN (p_content->'furnished')::text::boolean END,
    updated_at       = now()
  WHERE revision_id = p_revision_id;

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'owner', v_uid, v_revision.organization_id, 'listing_revision.update',
    'listing_revision', p_revision_id::text, v_correlation,
    'accepted', 'draft_updated');

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'revision_id', p_revision_id);
END $function$;

REVOKE ALL ON FUNCTION public.update_draft_revision(uuid, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_draft_revision(uuid, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.update_draft_revision(uuid, jsonb, text) IS
  'ADR-005 draft-editing command: full-content replace on a revision whose state is still draft; every other state is frozen or terminal. Audited; idempotency correlation recorded.';

-- ------------------------------------------------------------
-- 5. submit_revision_for_review — DRAFT→SUBMITTED (ADR-005). Mirrors the
--    listing lifecycle while unpublished, opens the 'submission'
--    moderation case, and records the deterministic ADR-013 pre-checks
--    (pass/fail/warn — validators only; they never approve or block).
--    No media check is recorded as 'warn' with a detail code rather
--    than 'fail': media attach is a separate owner surface and its
--    absence must not block human review (ADR-013 — only the moderator
--    decides).
-- ------------------------------------------------------------

-- -----
-- owner_listings_summary - recreated from 0013_owner_summary_lifecycle_filter_cast.sql L5-L94; city reference removed.
-- -----
CREATE OR REPLACE FUNCTION public.owner_listings_summary(
  p_organization_id uuid,
  p_lifecycle_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := public.current_app_user_id();
  v_filter public.listing_lifecycle_state;
  v_items jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated');
  END IF;

  IF NOT public.caller_is_org_member(p_organization_id) THEN
    INSERT INTO public.audit_records (actor_type, actor_id, organization_id,
      action, resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, p_organization_id, 'listing.read.summary',
      'listing', p_organization_id::text, gen_random_uuid()::text,
      'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this organization.');
  END IF;

  -- Enum-safe lifecycle filter: reject unknown values cleanly, then cast.
  IF p_lifecycle_filter IS NOT NULL AND p_lifecycle_filter NOT IN (
    'draft', 'submitted', 'changes_requested', 'rejected',
    'approved', 'publishing', 'published', 'withdrawn', 'closed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_lifecycle_filter',
      'message', 'Unknown lifecycle filter.');
  END IF;
  v_filter := p_lifecycle_filter::public.listing_lifecycle_state;

  SELECT coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) AS items
  FROM (
    SELECT
      l.listing_id,
      l.listing_kind,
      l.lifecycle_state,
      l.created_via,
      l.created_at,
      l.updated_at,
      l.withdrawn_at,
      l.closed_at,
      r.revision_id              AS published_revision_id,
      r.title                    AS published_title,
      r.description              AS published_description,
      r.property_type            AS published_property_type,
      r.property_subtype         AS published_property_subtype,
      r.availability             AS published_availability,
      (r.price_amount)::text     AS published_price_amount,
      r.price_currency           AS published_price_currency,
      r.price_period             AS published_price_period,
      r.bedrooms                 AS published_bedrooms,
      r.bathrooms                AS published_bathrooms,
      r.square_meters            AS published_square_meters,
      r.lot_size_sqm             AS published_lot_size_sqm,
      r.year_built               AS published_year_built,
      r.furnished                AS published_furnished,
      r.amenities                AS published_amenities,
      r.area                     AS published_area,
      r.town                     AS published_town,
      r.county                   AS published_county,
      r.country                  AS published_country,
      r.published_at             AS published_published_at
    FROM public.listings l
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.listing_revisions rr
      WHERE rr.revision_id = l.published_revision_id
        AND rr.listing_id = l.listing_id
    ) r ON TRUE
    WHERE l.organization_id = p_organization_id
      AND (v_filter IS NULL OR l.lifecycle_state = v_filter)
    ORDER BY l.updated_at DESC, l.listing_id
  ) s
  INTO v_items;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_listings_summary(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_listings_summary(uuid, text) TO authenticated;

-- -----
-- owner_listing_revision - recreated from 0004_owner_read_rpcs.sql L184-L294; city reference removed.
-- -----
CREATE OR REPLACE FUNCTION public.owner_listing_revision(
  p_revision_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid  uuid := public.current_app_user_id();
  v_row  public.listing_revisions%ROWTYPE;
  v_org  uuid;
  v_kind text;
  v_state text;
BEGIN
  IF v_uid IS NULL THEN
    INSERT INTO public.audit_records (actor_type, actor_id, organization_id,
      action, resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, NULL, 'revision.read.one',
      'listing_revision', p_revision_id::text, gen_random_uuid()::text,
      'rejected', 'not_authenticated');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to view listing revisions.');
  END IF;

  -- Resolve the org via the listing composite, then re-check membership.
  SELECT l.organization_id, l.listing_kind, l.lifecycle_state
  INTO v_org, v_kind, v_state
  FROM public.listing_revisions lr
  JOIN public.listings l ON l.listing_id = lr.listing_id
  WHERE lr.revision_id = p_revision_id;

  IF NOT FOUND THEN
    INSERT INTO public.audit_records (actor_type, actor_id, organization_id,
      action, resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, NULL, 'revision.read.one',
      'listing_revision', p_revision_id::text, gen_random_uuid()::text,
      'rejected', 'not_found');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_found',
      'message', 'Revision not found.');
  END IF;

  IF NOT public.caller_is_org_member(v_org) THEN
    INSERT INTO public.audit_records (actor_type, actor_id, organization_id,
      action, resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_org, 'revision.read.one',
      'listing_revision', p_revision_id::text, gen_random_uuid()::text,
      'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this listing''s organization.');
  END IF;

  -- Fetch the full revision row. The authenticated role holds SELECT on all
  -- public-class columns (migration 0001 grant). We additionally have access
  -- to restricted columns (organization_id, created_by, created_via, etc.)
  -- because they're granted to authenticated — and that's intentional for the
  -- owner portal, which needs created_by, organization_id, and lifecycle
  -- state to render the edit surface and attribution. ADR-014 restricted
  -- operational fields (exact_address, latitude, longitude) do NOT exist on
  -- listing_revisions at all.
  SELECT * INTO v_row
  FROM public.listing_revisions
  WHERE revision_id = p_revision_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'listing_id',      v_row.listing_id,
    'organization_id', v_row.organization_id,
    'revision_id',     v_row.revision_id,
    'base_revision_id', v_row.base_revision_id,
    'revision_state',  v_row.revision_state,
    'listing_kind',    v_kind,
    'lifecycle_state', v_state,
    -- full public content
    'title',            v_row.title,
    'description',      v_row.description,
    'property_type',    v_row.property_type,
    'property_subtype', v_row.property_subtype,
    'availability',     v_row.availability,
    'price_amount',     (v_row.price_amount)::text,
    'price_currency',   v_row.price_currency,
    'price_period',     v_row.price_period,
    'bedrooms',         v_row.bedrooms,
    'bathrooms',        v_row.bathrooms,
    'square_meters',    v_row.square_meters,
    'lot_size_sqm',     v_row.lot_size_sqm,
    'year_built',       v_row.year_built,
    'floor_number',     v_row.floor_number,
    'total_floors',     v_row.total_floors,
    'plot_dimensions',  v_row.plot_dimensions,
    'land_size_raw',    v_row.land_size_raw,
    'area',             v_row.area,
    'town',             v_row.town,
    'county',           v_row.county,
    'country',          v_row.country,
    'amenities',        v_row.amenities,
    'furnished',        v_row.furnished,
    'created_by',       v_row.created_by,
    'created_via',      v_row.created_via,
    'created_at',       v_row.created_at,
    'updated_at',       v_row.updated_at,
    'published_at',     v_row.published_at
  );
END $function$;

REVOKE ALL ON FUNCTION public.owner_listing_revision(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_listing_revision(uuid) TO authenticated;

COMMENT ON FUNCTION public.owner_listing_revision(uuid) IS
  'ADR-005/012 owner revision detail: full revision content for a listing the caller''s org owns. Grants to authenticated only.';

-- -----
-- moderator_cases_summary - recreated from 0005_moderation_domain_commands.sql L99-L178; city reference removed.
-- -----
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

-- -----
-- moderator_case_detail - recreated from 0005_moderation_domain_commands.sql L179-L312; city reference removed.
-- -----
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

-- -----
-- Drop the column. The column-level GRANT in 0001 lists city explicitly;
-- dropping the column removes that one privilege and nothing else.
-- -----
ALTER TABLE public.listing_revisions
  DROP COLUMN city;
