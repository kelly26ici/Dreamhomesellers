-- Migration 0013 (corrected): owner_listings_summary lifecycle-filter cast.
-- Body mirrors 0004 exactly; the ONLY change is the enum-safe filter
-- comparison plus a clean guard for unknown values.

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
      AND (v_filter IS NULL OR l.lifecycle_state = v_filter)
    ORDER BY l.updated_at DESC, l.listing_id
  ) s
  INTO v_items;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_listings_summary(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_listings_summary(uuid, text) TO authenticated;
