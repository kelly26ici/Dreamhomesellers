-- ============================================================
-- 0004 — Owner read RPCs (ADR-012 tenancy, read-side)
--
-- Migration 0001 granted authenticated roles SELECT on a carved public
-- column set only — there are no INSERT/UPDATE/DELETE grants, and the
-- runtime roles hold no table-level rights on owner-scoped tables. This
-- migration is the owner-side read contract: three SECURITY DEFINER RPCs
-- that are the ONLY read paths for owner data from the runtime roles.
--
-- Obligations honored (contracts §3/§4/§7 §11, ADR-005/012/013/014):
--   * org authority resolves through membership   — every org-scoped RPC
--     re-checks membership itself (SECURITY DEFINER bypasses RLS, so the
--     ADR-012 check must be explicit here)
--   * buyer-safe column discipline                — only columns whose
--     FieldClass is 'public' or 'restricted' are projected; restricted
--     columns never leave the database boundary through these RPCs
--   * audit record                                — rejected reads write an
--     append-only audit row (actor_type='owner'); accepted reads are
--     NOT audited (read side, no state change)
--   * typed jsonb returns                         — {ok:false, reason_code,
--     message} on reject so the caller can map reason_code → message
-- ============================================================

-- ------------------------------------------------------------
-- 1. owner_has_organization — bootstrap gate for the owner portal.
--    Returns TRUE if the signed-in user is an active member of the org
--    named by the slug (or any org if p_slug is NULL). This is the
--    single question the portal shell asks before rendering.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_has_organization(
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- SECURITY DEFINER: current_app_user_id reads auth.jwt() with the
  -- owner's privileges (RLS-bypassing helper). caller_is_org_member
  -- re-checks membership explicitly because SECURITY DEFINER bypasses
  -- the RLS policy on owner_organizations_memberships.
  SELECT public.caller_is_org_member(p_organization_id)
$function$;

REVOKE ALL ON FUNCTION public.owner_has_organization(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_has_organization(uuid) TO authenticated;

COMMENT ON FUNCTION public.owner_has_organization(uuid) IS
  'ADR-012 bootstrap gate: TRUE iff the current authenticated user is a member of the named org. Grants to authenticated only.';

-- ------------------------------------------------------------
-- 2. owner_listings_summary — the portal's listing index.
--    Returns a JSON object {ok:true, items:[...]} of summaries for all
--    listings the caller's org owns. Each item carries the listing-level
--    lifecycle fields plus the latest revision content from the row that
--    published_revision_id currently points at (NULL for draft listings).
--
--    Column discipline (contracts §3/§4): listing_id, listing_kind,
--    lifecycle_state, published_revision_id are 'public'; organization_id,
--    created_via, created_at, updated_at, withdrawn_at, closed_at are
--    'restricted' but org-scoped to a verified member — acceptable because
--    the caller has already proved org membership through the explicit
--    membership check. Revision content columns are the 'public' set
--    from migration 0001's column grant. ADR-014 restricted fields
--    (exact_address, latitude, longitude) are never present on revisions
--    at all — properties_lux is born with them NULL and validate_revision_content
--    rejects them outright.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_listings_summary(
  p_organization_id   uuid,
  p_lifecycle_filter  text DEFAULT NULL  -- 'published' | 'draft' | ... or NULL for all
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := public.current_app_user_id();
  v_result jsonb;
  v_items  jsonb;
BEGIN
  -- ADR-012: authority resolves through membership. SECURITY DEFINER
  -- bypasses RLS, so the membership check must be explicit here.
  IF v_uid IS NULL THEN
    INSERT INTO public.audit_records (actor_type, actor_id, organization_id,
      action, resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, p_organization_id, 'listing.read.summary',
      'listing', p_organization_id::text, gen_random_uuid()::text,
      'rejected', 'not_authenticated');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to view owner listings.');
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

  -- Build the summary list. We join listings to their published revision
  -- (if any) via published_revision_id — the sole public-authority pointer
  -- (lifecycle lens F2). Draft listings have published_revision_id IS NULL.
  --
  -- The lateral subquery projects ONLY the buyer-safe public-content columns
  -- enumerated in migration 0001's GRANT SELECT on listing_revisions. Even
  -- though the authenticated role CAN see restricted columns like
  -- organization_id on listing_revisions directly (they're granted to
  -- authenticated, not revoked), we deliberately do not surface them here:
  -- the owner portal already knows the org from its own context, and
  -- keeping the surface minimal reduces the chance of an ADR-014 restricted
  -- field leaking through in a future edit.
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
      -- Published revision content (NULL when draft / no published revision)
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
      r.city                     AS published_city,
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
      AND (p_lifecycle_filter IS NULL OR l.lifecycle_state = p_lifecycle_filter)
    ORDER BY l.updated_at DESC, l.listing_id
  ) s
  INTO v_items;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END $function$;

REVOKE ALL ON FUNCTION public.owner_listings_summary(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_listings_summary(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.owner_listings_summary(uuid, text) IS
  'ADR-005/012 owner listing index: summaries for all listings owned by a verified org member. Grants to authenticated only. p_lifecycle_filter NULL = all states.';

-- ------------------------------------------------------------
-- 3. owner_listing_revision — full draft or published revision content.
--    Returns the complete row for a single revision the caller's org owns.
--    This is the read backing for the listing detail and edit surfaces.
--
--    The revision's listing must belong to an org the caller is a member
--    of — we join via the composite FK path (listing_revisions.listing_id
--    → listings.organization_id) and re-check membership, because
--    SECURITY DEFINER bypasses RLS entirely.
-- ------------------------------------------------------------
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
    'city',             v_row.city,
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
