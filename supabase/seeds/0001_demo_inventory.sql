-- ============================================================
-- Demo inventory seed — 0001 (2026-10-12)
-- ============================================================
-- PURPOSE: exercise the Phase 1 lifecycle end-to-end and give the Phase 4
-- buyer-discovery build real published rows to render. Synthetic Kenyan
-- inventory under one demo organization, walked draft -> published through
-- the same guard triggers and FK chain production writes will face.
--
-- THIS IS NOT THE ADR-015 LEGACY IMPORT. The 4,259 inherited rows stay an
-- unverified, owner-confirmed-before-publication import path. Every row here
-- is created_via 'owner' demo material under org ...c002 and can be purged
-- with the block at the bottom of this file.
--
-- Idempotent: deterministic UUIDs + ON CONFLICT DO NOTHING. The state walk
-- only touches rows that are still draft, so re-running is a no-op once
-- published.
--
-- Statement order is load-bearing: the revisions -> published flip must run
-- BEFORE the listings UPDATE, because listings(published_revision_id,
-- listing_id) FKs listing_revisions(published_ref_revision_id, listing_id)
-- and that generated column is non-NULL only once revision_state='published'.
-- ============================================================

BEGIN;

-- ---- 0. Demo owner principal -------------------------------------------
-- One stub auth user (only id is NOT NULL beyond defaults) + one organization
-- + an owner membership, so created_by references resolve.
INSERT INTO auth.users (id, email, is_sso_user, is_anonymous)
VALUES (
  '00000000-0000-0000-0000-00000000c001',
  'demo-owner@luxonn.invalid',
  false,
  false
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.owner_organizations (
  organization_id, display_name, kind, is_internal, public_bio, is_verified
) VALUES (
  '00000000-0000-0000-0000-00000000c002',
  'LUXONN Demo Estates',
  'agency',
  false,
  'Synthetic demo inventory used to exercise the marketplace lifecycle. Not real listings.',
  false
) ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO public.owner_organizations_memberships (
  organization_id, user_id, member_role
) VALUES (
  '00000000-0000-0000-0000-00000000c002',
  '00000000-0000-0000-0000-00000000c001',
  'owner'
) ON CONFLICT (organization_id, user_id) DO NOTHING;

-- ---- 1. Properties ------------------------------------------------------
-- ADR-014: exact_address/latitude/longitude stay NULL in the seed. Public
-- revisions carry area-level fields only; the precise address is released
-- after an accepted viewing, which the demo does not simulate.
INSERT INTO public.properties_lux (
  property_id, organization_id, exact_address, latitude, longitude,
  verification_status, source, external_id, created_via
) VALUES
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-001', 'owner'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-002', 'owner'),
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-003', 'owner'),
  ('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-004', 'owner'),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-005', 'owner'),
  ('00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-006', 'owner'),
  ('00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-007', 'owner'),
  ('00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-008', 'owner'),
  ('00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-009', 'owner'),
  ('00000000-0000-0000-0000-000000000a10', '00000000-0000-0000-0000-00000000c002', NULL, NULL, NULL, 'verified', 'demo_seed', 'demo-p-010', 'owner')
ON CONFLICT (property_id) DO NOTHING;

-- ---- 2. Listings (draft) -------------------------------------------------
INSERT INTO public.listings (
  listing_id, property_id, organization_id, listing_kind,
  lifecycle_state, published_revision_id, created_via
) VALUES
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-00000000c002', 'sale',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-00000000c002', 'sale',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-00000000c002', 'sale',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b04', '00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-00000000c002', 'sale',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b05', '00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-00000000c002', 'sale',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b06', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-00000000c002', 'rent',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b07', '00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-00000000c002', 'rent',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b08', '00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-00000000c002', 'rent',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b09', '00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-00000000c002', 'rent',     'draft', NULL, 'owner'),
  ('00000000-0000-0000-0000-000000000b10', '00000000-0000-0000-0000-000000000a10', '00000000-0000-0000-0000-00000000c002', 'shortlet', 'draft', NULL, 'owner')
ON CONFLICT (listing_id) DO NOTHING;

-- ---- 3. Draft revisions --------------------------------------------------
-- Contracts §4 public content only. area/city/county are area-level (ADR-014);
-- price_currency/price_period stated explicitly (no DEFAULTs — the product
-- default is the domain layer's job, ADR-001). KES throughout. Each row is
-- exactly 32 values, in table-definition order (verified line by line).
INSERT INTO public.listing_revisions (
  revision_id, listing_id, organization_id, base_revision_id, revision_state,
  title, description, property_type, property_subtype, availability,
  price_amount, price_currency, price_period,
  bedrooms, bathrooms, square_meters, lot_size_sqm, year_built,
  floor_number, total_floors, plot_dimensions, land_size_raw,
  area, city, town, county, country,
  amenities, furnished, created_by, created_via, published_at
) VALUES
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Karen — 5-Bedroom Standalone Villa on Half an Acre',
   'A substantial standalone villa on a mature half-acre garden in Karen. The plan runs wide rather than tall: a double-volume living room, formal dining, a study, and a kitchen with a separate pantry open onto a wraparound veranda. All five bedrooms are en-suite; the principal suite takes the garden side with a dressing room and private terrace. Domestic quarters and a two-car garage sit off a gated service yard. Borehole water and a solar array back the mains.',
   'villa', 'standalone', 'available',
   145000000, 'KES', 'one_time',
   5, 6, 620, 2023, 2019,
   NULL, NULL, NULL, NULL,
   'Karen', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['borehole','solar backup','staff quarters','garage','garden','fireplace'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Runda — 4-Bedroom Townhouse in a Gated Court of Six',
   'A corner townhouse in a small gated court off Kiambu Road, Runda. Six units share a drilled borehole, electric fence, and a 24-hour manned gate. The house is arranged over two floors with a suspended family room, four en-suite bedrooms, and a kitchen opening to a breakfast terrace. The corner plot takes a private garden and two dedicated parking bays.',
   'townhouse', 'gated_community', 'available',
   89500000, 'KES', 'one_time',
   4, 4, 340, NULL, 2021,
   2, 2, NULL, NULL,
   'Runda', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['gated community','borehole','24-hour security','private garden','2 parking bays'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Westlands — 3-Bedroom Apartment with Rift Views, 8th Floor',
   'A high-floor apartment in a 2018 tower off Ring Road, Westlands. The living area and principal bedroom face the city skyline with the Rift escarpment visible on clear evenings. Interiors carry engineered-oak floors, a fitted kitchen with island, and three bathrooms. The building runs a gym, heated pool, back-up generator, and two basement bays, with Sarit Centre inside a five-minute walk.',
   'apartment', 'high_rise', 'available',
   42000000, 'KES', 'one_time',
   3, 3, 210, NULL, 2018,
   8, 12, NULL, NULL,
   'Westlands', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['gym','pool','backup generator','basement parking','lift','balcony'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c04', '00000000-0000-0000-0000-000000000b04', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Lavington — 4-Bedroom Family Townhouse on a Quiet Lane',
   'A family townhouse on a cul-de-sac in Lavington, set back behind a mature hedge. Ground floor: reception rooms in sequence, a guest cloakroom, and a kitchen with garden access. Upstairs: four bedrooms, the principal en-suite with a balcony over the rear garden. A self-contained one-bedroom annexe suits staff or visiting family. The plot takes six cars behind the gate.',
   'townhouse', 'standalone', 'available',
   68000000, 'KES', 'one_time',
   4, 4, 380, 900, 2016,
   NULL, NULL, NULL, NULL,
   'Lavington', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['annexe','garden','off-street parking','borehole','cctv'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-000000000b05', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Runda — Half-Acre Level Plot Ready for Development',
   'A level, fenced half-acre plot on a tarmac-accessed lane in Runda Mhasibu. All-weather access, water and electricity at the boundary, and an approved sewer connection in place. The plot sits within an established low-density residential zone suited to a private residence or a small gated development, with several completed builds on the same lane.',
   'land', NULL, 'available',
   55000000, 'KES', 'one_time',
   NULL, NULL, NULL, 2023, NULL,
   NULL, NULL, 'approx. 50 m x 40 m', '0.5 acre (approx. 2,023 m²)',
   'Runda', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['fenced','water at boundary','electricity at boundary','tarmac access'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-000000000b06', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Kilimani — 3-Bedroom Apartment steps from Yaya Centre',
   'A bright third-floor apartment in a small managed block a short walk from Yaya Centre, Kilimani. The living room opens to a balcony with tree-lined street views; the kitchen is fitted with granite worktops. Three bedrooms, the principal en-suite, plus a guest bathroom. The block keeps a rooftop terrace, back-up generator, borehole, and one dedicated basement bay.',
   'apartment', 'mid_rise', 'available',
   165000, 'KES', 'per_month',
   3, 3, 185, NULL, 2015,
   3, 5, NULL, NULL,
   'Kilimani', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['rooftop terrace','backup generator','borehole','basement parking','lift','balcony'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-000000000b07', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Westlands — Furnished 2-Bedroom Apartment near Sarit',
   'A fully furnished two-bedroom apartment in a serviced block near Sarit Centre, Westlands. Furnishings are contemporary and complete down to kitchenware and fibre Wi-Fi. The principal bedroom is en-suite; the second bedroom suits guests or a home office. Rates include housekeeping twice weekly, gym and pool access, generator and borehole cover, and one reserved parking bay.',
   'apartment', 'serviced', 'available',
   220000, 'KES', 'per_month',
   2, 2, 140, NULL, 2020,
   5, 9, NULL, NULL,
   'Westlands', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['furnished','serviced','gym','pool','wifi included','housekeeping','parking'], true,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c08', '00000000-0000-0000-0000-000000000b08', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Nyali — 4-Bedroom Swahili-Style Villa near the Reef',
   'A Swahili-inspired villa in Nyali, Mombasa, set in a coral-rag walled garden a few minutes from the reef hotels. Baraza-lined verandas, a central courtyard with a plunge pool, and high ceilings through the reception rooms. Four bedrooms, three en-suite, plus staff quarters. The garden carries mango, coconut, and frangipani; the beach is a five-minute walk.',
   'villa', 'coastal', 'available',
   350000, 'KES', 'per_month',
   4, 4, 460, 1100, 2012,
   NULL, NULL, NULL, NULL,
   'Nyali', 'Mombasa', NULL, 'Mombasa', 'Kenya',
   ARRAY['plunge pool','walled garden','staff quarters','borehole','generator','beach nearby'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c09', '00000000-0000-0000-0000-000000000b09', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Naivasha — 3-Bedroom Lake-View House on an Acre',
   'A single-storey house on a one-acre plot above the Naivasha shoreline. The veranda runs the length of the house and frames lake and Hell''s Gate views. Three bedrooms, two bathrooms, an open kitchen-diner, and a stone fireplace for cool evenings. The land carries mature acacia, a kitchen garden, and space for stables; the lake gate is at the end of the lane.',
   'house', 'countryside', 'available',
   180000, 'KES', 'per_month',
   3, 2, 240, 4047, 2014,
   NULL, NULL, NULL, NULL,
   'Naivasha', 'Naivasha', NULL, 'Nakuru', 'Kenya',
   ARRAY['lake view','fireplace','garden','borehole','solar water heating','pets allowed'], false,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL),

  ('00000000-0000-0000-0000-000000000c10', '00000000-0000-0000-0000-000000000b10', '00000000-0000-0000-0000-00000000c002', NULL, 'draft',
   'Kilimani — Furnished 1-Bedroom Shortlet near Prestige',
   'A compact furnished one-bedroom shortlet in a secure block near Prestige Plaza, Kilimani. Suited to stays from a week upward: full kitchen, work desk, fast fibre, DStv, and weekly cleaning included. The block runs a gym, backup water, and night security; underground parking is available on request.',
   'apartment', 'serviced', 'available',
   12500, 'KES', 'per_night',
   1, 1, 58, NULL, 2022,
   4, 6, NULL, NULL,
   'Kilimani', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['furnished','wifi included','gym','weekly cleaning','night security'], true,
   '00000000-0000-0000-0000-00000000c001', 'owner', NULL)
ON CONFLICT (revision_id) DO NOTHING;

-- ---- 4. Media rows --------------------------------------------------------
-- Phase 3 (media ingestion) has not run: no Storage originals exist. Rows are
-- marked processed + approved ONLY so the public-read policy can serve them;
-- original_path/derivative_paths are empty and the grid renders its designed
-- media-pending placeholder. Nothing here pretends to be a photograph.
INSERT INTO public.listing_media (
  media_id, revision_id, organization_id, position, kind, is_featured,
  source, original_path, derivative_paths,
  processing_status, moderation_status, content_hash
)
SELECT
  ('00000000-0000-0000-0000-' || lpad(to_hex(row_number() OVER (ORDER BY r.revision_id, m.position)), 12, '0'))::uuid,
  r.revision_id, r.organization_id,
  m.position, 'image', (m.position = 0),
  'owner_upload', NULL, '{}',
  'processed', 'approved', NULL
FROM public.listing_revisions r
CROSS JOIN (VALUES (0), (1), (2)) AS m(position)
WHERE r.organization_id = '00000000-0000-0000-0000-00000000c002'
  AND r.revision_state = 'draft'
ON CONFLICT (revision_id, position) DO NOTHING;

-- ---- 5. The lifecycle walk ------------------------------------------------
-- Guard triggers read current_setting('luxonn.domain_command', true) and stay
-- silent only inside it. Draft -> published in one step (intermediate states
-- carry no extra constraints; production domain commands in 0002 will walk
-- them stepwise).
SET LOCAL luxonn.domain_command = 'on';

UPDATE public.listing_revisions
SET revision_state = 'published',
    published_at   = now(),
    updated_at     = now()
WHERE organization_id = '00000000-0000-0000-0000-00000000c002'
  AND revision_state  = 'draft';

-- Second statement on purpose: published_ref_revision_id (generated) must be
-- recomputed by the UPDATE above before the FK below can resolve.
UPDATE public.listings l
SET lifecycle_state       = 'published',
    published_revision_id = r.revision_id,
    updated_at            = now()
FROM public.listing_revisions r
WHERE r.listing_id = l.listing_id
  AND r.revision_state = 'published'
  AND l.lifecycle_state = 'draft'
  AND l.organization_id = '00000000-0000-0000-0000-00000000c002';

COMMIT;

-- ---- Verification (run separately; expected: 10 / 10 / 30 / 10) -------------
-- SELECT count(*) FROM public.listing_revisions
--  WHERE organization_id = '00000000-0000-0000-0000-00000000c002'
--    AND revision_state = 'published';
-- SELECT count(*) FROM public.listings
--  WHERE organization_id = '00000000-0000-0000-0000-00000000c002'
--    AND lifecycle_state = 'published'
--    AND published_revision_id IS NOT NULL;
-- SELECT count(*) FROM public.listing_media
--  WHERE organization_id = '00000000-0000-0000-0000-00000000c002';
-- SELECT count(*) FROM public.listings;  -- as anon: must equal 10 (RLS gate)

-- ---- Purge (run alone when real inventory replaces the demo) ----------------
-- BEGIN;
-- DELETE FROM public.listing_media      WHERE organization_id = '00000000-0000-0000-0000-00000000c002';
-- DELETE FROM public.listing_revisions  WHERE organization_id = '00000000-0000-0000-0000-00000000c002';
-- DELETE FROM public.listings           WHERE organization_id = '00000000-0000-0000-0000-00000000c002';
-- DELETE FROM public.properties_lux     WHERE organization_id = '00000000-0000-0000-0000-00000000c002';
-- DELETE FROM public.owner_organizations_memberships WHERE organization_id = '00000000-0000-0000-0000-00000000c002';
-- DELETE FROM public.owner_organizations WHERE organization_id = '00000000-0000-0000-0000-00000000c002';
-- COMMIT;
