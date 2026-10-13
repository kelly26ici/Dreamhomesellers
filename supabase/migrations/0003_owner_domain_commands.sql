-- ============================================================
-- 0003 — Owner domain commands (ADR-005 lifecycle, ADR-012 tenancy)
--
-- Migration 0001 granted authenticated roles SELECT on a carved public
-- column set only — there are no INSERT/UPDATE/DELETE table grants on
-- listings/listing_revisions for the runtime roles, so the browser
-- client can never write the lifecycle directly. The state guards
-- (guard_revision_state / guard_listing_state) additionally require the
-- luxonn.domain_command GUC for every state transition and pointer
-- change. This migration is the owner-side of that contract: the
-- SECURITY DEFINER RPCs that are the ONLY write paths into the listing
-- lifecycle from the runtime roles.
--
-- Obligations honored (contracts §3/§4/§7/§11, ADR-005/012/013/014):
--   * org authority resolves through membership  — every org-scoped
--     command re-checks membership itself (SECURITY DEFINER bypasses
--     RLS, so the ADR-012 check must be explicit here)
--   * ADR-014 restricted set                      — content commands
--     REJECT any payload carrying exact_address / latitude / longitude;
--     properties_lux rows are born with them NULL
--   * audit record                                — every attempt
--     (accepted AND rejected) writes an append-only audit row with
--     actor_type='owner'; domain rejections RETURN a typed result
--     instead of raising so the audit row survives the transaction
--   * idempotency                                 — replay with the same
--     idempotency key returns the original result (resolved through
--     audit_records.request_id, the same correlation key the audit uses)
--   * outbox events                               — one per transition,
--     buyer-safe payload only (the table CHECK backstops dangerous keys)
--   * moderation coupling (ADR-013)               — submit opens a
--     'submission' moderation case and records deterministic pre-checks;
--     they never approve or block autonomously
--   * GUC discipline                              — state transitions set
--     luxonn.domain_command='on' locally; each command re-checks states
--     explicitly in PL/pgSQL so the GUC never widens what it may do
-- ============================================================

-- ------------------------------------------------------------
-- Shared helper: is the caller a member of the org? SECURITY DEFINER
-- bypasses RLS, so every org-scoped command checks explicitly (ADR-012:
-- authority resolves org → membership → user, never the reverse).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caller_is_org_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.owner_organizations_memberships m
     WHERE m.organization_id = p_organization_id
       AND m.user_id = public.current_app_user_id()
  )
$function$;

REVOKE ALL ON FUNCTION public.caller_is_org_member(uuid) FROM public;

COMMENT ON FUNCTION public.caller_is_org_member(uuid) IS
  'Membership check for owner domain commands (SECURITY DEFINER helpers bypass RLS, so commands verify ADR-012 authority explicitly).';

-- ------------------------------------------------------------
-- Shared revision-content validation. Returns NULL when the payload is
-- valid; otherwise a typed {ok:false, reason_code} rejection. Shared so
-- create / update / correction commands enforce identical rules
-- (contracts §4 field rules; ADR-014 restricted-field rejection;
-- ADR-001 explicit money and currency).
-- p_for_listing_create: when true, listing_kind is required (it is
-- immutable per Listing and set at creation only — contracts §3).
-- ------------------------------------------------------------
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
  IF COALESCE(btrim(COALESCE(p_content->>'city','')),'') = ''
     OR length(p_content->>'city') > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_city',
      'message', 'city is required (1-100 characters).');
  END IF;
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

-- ------------------------------------------------------------
-- 1. create_solo_organization — the ADR-012 solo-owner onboarding
--    command. Solves the bootstrap cycle: org_admin_manage requires
--    is_org_admin(org), which requires a membership, which requires an
--    org. This command creates the org AND the founder's owner
--    membership atomically. Plain table writes cannot do this because
--    the runtime roles hold no INSERT grants on either table.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_solo_organization(
  p_display_name    text,
  p_public_bio      text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid          uuid := public.current_app_user_id();
  v_org_id       uuid;
  v_display_name text;
  v_correlation  text;
  v_existing     uuid;
  v_attempts     integer := 0;
  v_member_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to create an organization.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- ---------- idempotent replay ----------
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT resource_id::uuid INTO v_existing
      FROM public.audit_records
     WHERE action = 'organization.create'
       AND request_id = v_correlation
       AND outcome = 'accepted'
       AND actor_id = v_uid
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
        'organization_id', v_existing);
    END IF;
  END IF;

  -- ---------- validation ----------
  v_display_name := btrim(COALESCE(p_display_name, ''));
  IF v_display_name = '' OR length(v_display_name) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_display_name',
      'message', 'Organization name is required (1-120 characters).');
  END IF;
  IF p_public_bio IS NOT NULL AND length(p_public_bio) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_bio',
      'message', 'public_bio must be at most 2000 characters.');
  END IF;

  -- Soft cap: without a ceiling an account could mint unbounded tenants.
  SELECT count(*) INTO v_member_count
    FROM public.owner_organizations_memberships m WHERE m.user_id = v_uid;
  IF v_member_count >= 3 THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, action, resource_type, resource_id,
      request_id, outcome, reason_code)
    VALUES ('owner', v_uid, 'organization.create', 'organization',
      v_uid::text, v_correlation, 'rejected', 'org_limit_reached');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'org_limit_reached',
      'message', 'This account already belongs to the maximum number of organizations.');
  END IF;

  -- ---------- create org + founder membership atomically ----------
  v_org_id := gen_random_uuid();
  LOOP
    v_attempts := v_attempts + 1;
    BEGIN
      INSERT INTO public.owner_organizations
        (organization_id, display_name, kind, is_internal, public_bio, is_verified)
      VALUES
        (v_org_id, v_display_name, 'solo', false, p_public_bio, false);

      INSERT INTO public.owner_organizations_memberships
        (organization_id, user_id, member_role)
      VALUES
        (v_org_id, v_uid, 'owner');
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 3 THEN RAISE; END IF;
      -- org-id collision (astronomically unlikely): retry with a new id
    END;
  END LOOP;

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'owner', v_uid, v_org_id, 'organization.create',
    'organization', v_org_id::text, v_correlation, 'accepted', 'solo_created');

  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload)
  VALUES (
    v_org_id, 'organization.created', 'organization', v_org_id::text,
    v_correlation,
    jsonb_build_object(
      'organization_id', v_org_id,
      'display_name', v_display_name,
      'kind', 'solo'));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'organization_id', v_org_id);
END $function$;

REVOKE ALL ON FUNCTION public.create_solo_organization(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_solo_organization(text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.create_solo_organization(text, text, text) IS
  'ADR-012 solo-owner onboarding domain command: creates the organization and the founder''s owner membership atomically (the RLS bootstrap cycle makes plain writes impossible). Audited, idempotent, capped at 3 orgs per account.';

-- ------------------------------------------------------------
-- 2. create_listing_draft — Property + Listing + first DRAFT revision in
--    one transaction (contracts §3: a kind change is a new Listing, so
--    listing_kind is fixed at creation). created_by / created_via are
--    stamped server-side, never taken from the payload.
-- ------------------------------------------------------------
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
    area, city, town, county, country,
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
    btrim(p_content->>'city'),
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
    area, city, town, county, country,
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
    btrim(p_content->>'city'),
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
    city             = btrim(p_content->>'city'),
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
               AND btrim(v_revision.city) <> ''
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

-- ------------------------------------------------------------
-- 6. withdraw_listing — PUBLISHED→WITHDRAWN (ADR-005). The published
--    pointer is retained (contracts §11); visibility gates on
--    lifecycle_state, and downstream consumers learn through the outbox.
--    Moderator takedown is a separate, later moderation command.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_listing(
  p_listing_id      uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_listing     public.listings%ROWTYPE;
  v_correlation text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to withdraw a listing.');
  END IF;
  IF p_listing_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'listing_id is required.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- ---------- idempotent replay ----------
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.audit_records
       WHERE action = 'listing.withdraw'
         AND request_id = v_correlation
         AND outcome = 'accepted'
         AND actor_id = v_uid
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
        'listing_id', p_listing_id);
    END IF;
  END IF;

  SELECT * INTO v_listing FROM public.listings l WHERE l.listing_id = p_listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_not_found',
      'message', 'No such listing.');
  END IF;
  IF NOT public.caller_is_org_member(v_listing.organization_id) THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_listing.organization_id, 'listing.withdraw',
      'listing', p_listing_id::text, v_correlation, 'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this listing''s organization.');
  END IF;
  IF v_listing.lifecycle_state <> 'published' THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_listing.organization_id, 'listing.withdraw',
      'listing', p_listing_id::text, v_correlation, 'rejected', 'invalid_state');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_state',
      'message', 'Only a published listing can be withdrawn.');
  END IF;

  -- ---------- transition: PUBLISHED → WITHDRAWN (pointer retained) ----------
  PERFORM set_config('luxonn.domain_command', 'on', true);
  UPDATE public.listings
     SET lifecycle_state = 'withdrawn',
         withdrawn_at    = now(),
         updated_at      = now()
   WHERE listing_id = p_listing_id;
  PERFORM set_config('luxonn.domain_command', 'off', true);

  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'owner', v_uid, v_listing.organization_id, 'listing.withdraw',
    'listing', p_listing_id::text, v_correlation, 'accepted', 'withdrawn');

  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload)
  VALUES (
    v_listing.organization_id, 'listing.withdrawn', 'listing',
    p_listing_id::text, v_correlation,
    jsonb_build_object(
      'listing_id', p_listing_id,
      'organization_id', v_listing.organization_id,
      'published_revision_id', v_listing.published_revision_id));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'listing_id', p_listing_id);
END $function$;

REVOKE ALL ON FUNCTION public.withdraw_listing(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.withdraw_listing(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.withdraw_listing(uuid, text) IS
  'ADR-005 withdrawal command: PUBLISHED→WITHDRAWN with the published pointer retained (visibility gates on lifecycle_state). Audited; buyer-safe outbox event; moderator takedown remains a separate moderation command.';
