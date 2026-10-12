-- ============================================================
-- Legacy curated import seed — 0002 (2026-10-13)
-- ============================================================
-- PURPOSE: 20 curated Kenyan rows from the ADR-015 read-only legacy pool
-- (4,259 candidates), imported into the Phase 1 schema under one
-- non-internal organization so the buyer grid gains real, diverse,
-- human-entered inventory. Facts are AS-ENTERED by the original agent.
--
-- PROVENANCE AND POSTURE
-- - properties_lux.verification_status = 'unverified': LUXONN has not run
--   verification. listing_revisions.created_by IS NULL (imported, not
--   owner-authored). created_via = 'import' on every table.
-- - Restricted ADR-014 fields (exact_address, latitude, longitude) and
--   consent-bound contact data (public_contact_*, agents) were NEVER read
--   and are NOT imported.
-- - Legacy property_images are external stock-CDN references, not
--   photographs of the listed properties. They are preserved as
--   listing_media rows with source='inherited_external',
--   processing_status='pending', moderation_status='unreviewed' — which the
--   public-read RLS policy hides by design. The buyer surface shows the
--   media-pending placeholder until Phase 3 validates real imagery.
--   Nothing here fabricates a photograph.
--
-- LOSSY-MAPPING NOTES (documented, not silent)
-- - 6 rent rows: legacy price_period is uniformly 'one_time' (the legacy
--   enum never distinguished periods); mapped to 'per_month' by inference.
-- - 2 land rows store acres in square_meters ('3 ac' -> 3.0); acres parsed
--   from the title and converted to lot_size_sqm (x 4046.86);
--   square_meters NULLed. 1 land row in genuine m² kept as lot_size_sqm.
-- - 1 villa row (Galu) carried square_meters = 1.0 — entry error, NULLed.
-- - Land rows have bedrooms, bathrooms, and year_built NULLed (1 row carried
--   bedrooms=4/bathrooms=5 as entered; these are meaningless on land).
-- - 9 city normalizations (4x 'Nairobi Metro' -> county; 5x city == area -> county).
-- - Amenity tokens converted snake_case -> label case. Legacy
--   property_subtype is NULL throughout; column left NULL.
--
-- Idempotent (deterministic uuid5 IDs + ON CONFLICT DO NOTHING). Statement
-- order is load-bearing: revisions flip to published BEFORE the listings
-- pointer UPDATE, exactly as in 0001.
-- ============================================================

BEGIN;

-- ---- 0. Import organization (no members: imports are not owner-authored;
--         revisions carry created_by NULL; the org is claimable later) ----
INSERT INTO public.owner_organizations (
  organization_id, display_name, kind, is_internal, public_bio, is_verified
) VALUES (
  '9b2bd10f-0d6a-56a3-ba53-fafb72482627',
  'LUXONN Heritage Portfolio',
  'agency',
  false,
  'Kenyan records imported from LUXONN''s legacy property pool (ADR-015) as unverified demo inventory. Facts are as-entered by the original agent; imagery is pending verification.',
  false
) ON CONFLICT (organization_id) DO NOTHING;

-- ---- 1. Properties (restricted fields NULL by ADR-014 posture) ----------
INSERT INTO public.properties_lux (
  property_id, organization_id, exact_address, latitude, longitude,
  verification_status, source, external_id, created_via
) VALUES
  ('dc360b47-6652-56d4-a822-607090bfaab5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '04660d99-837e-4067-8e1a-82d7ef0ca94e', 'import'),
  ('5456fae5-464a-54cf-95d5-6d21a462f046', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '06a78156-349b-4df9-8b0e-fedf70f2d1e2', 'import'),
  ('a18274f2-e6f2-5921-a046-41136485ba8b', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '0bc28b26-f326-4a51-828b-81e3d3986fa1', 'import'),
  ('fdd3332b-31d6-515c-b42d-020339010697', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '0ecc3e92-4223-4d85-b8f7-c86962c89d7c', 'import'),
  ('51f7c5ae-5126-590b-a1df-2036c5eff481', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '965b41bd-a835-4ca0-9371-746f50d91132', 'import'),
  ('cfc735c5-ee10-5fa3-b7cf-03f959150f85', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', 'b73f6169-ccca-4af7-aa11-657c8c0d5500', 'import'),
  ('328ad48b-44ce-5054-a19c-29f33bdc475f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', 'fe59b089-9cd9-4598-9caa-ff47f71fa6da', 'import'),
  ('3a38f6d6-98ff-542b-a21b-5cacc9554f35', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '0566d039-fc97-436c-adbb-277b29e70514', 'import'),
  ('66426e03-cfc7-5905-9849-143c6a5402c6', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '0784b40f-bada-4a1b-ae5f-ed4ac29cafd1', 'import'),
  ('fa5e3195-27dd-5777-a649-52a2c060fde1', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '08ad2bce-0b50-48f1-90f3-0bf67a8ba3ec', 'import'),
  ('dc2c0024-1273-511f-84b4-3cc5439a1b7e', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '0a7dd483-b87e-4741-8b30-cced26e57d94', 'import'),
  ('4bacb264-3918-5df6-9892-9185b2a75c16', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '0fa46223-517e-49c6-b942-d1d980a14bb4', 'import'),
  ('c2f45762-06b5-56e1-8fc8-fcf3e0f625a1', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '11aa9be8-d63b-44f8-bc21-03ba015e7f06', 'import'),
  ('13aec35c-b256-5b34-bc35-70899f681713', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '14078c74-ffc3-4ad9-84bb-a608fa044978', 'import'),
  ('41fbcd10-447e-59e8-b63c-c99326cc89ad', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '1c7479e4-d466-443e-9eef-d8705018ede3', 'import'),
  ('e055dffd-3557-566e-b31b-9b88dbe6e9ed', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '1e603978-2d93-46dc-b566-35018a26bd0a', 'import'),
  ('5a961027-fdf5-5006-ac40-b86407ac0747', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '258e2005-9f7b-4065-9c16-0f4a75ecb685', 'import'),
  ('fd2317e7-0098-5f0d-b53f-5122e1f9d517', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '30c968af-2bf1-42e7-ba54-10c6e643a8cd', 'import'),
  ('31c1fd6b-707d-58a9-a5f3-8ba6bbe46907', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '4dd76bb4-2f05-41cd-b5d6-26f2c66eaef1', 'import'),
  ('8d2fc0d2-e4f3-5fcb-b516-d6121805c765', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, NULL, NULL, 'unverified', 'legacy_import', '5483fbe5-a54c-4c43-b7d8-146184995fe7', 'import')
ON CONFLICT (property_id) DO NOTHING;

-- ---- 2. Listings (draft; pointer set in step 5) --------------------------
INSERT INTO public.listings (
  listing_id, property_id, organization_id, listing_kind,
  lifecycle_state, published_revision_id, created_via
) VALUES
  ('303bc541-0768-534c-ad94-ca89522be640', 'dc360b47-6652-56d4-a822-607090bfaab5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('48e6223f-3c13-56a7-aef2-ab1019ff4efa', '5456fae5-464a-54cf-95d5-6d21a462f046', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('e7e270ab-2e70-504e-b26a-53acc222ee55', 'a18274f2-e6f2-5921-a046-41136485ba8b', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('3d098a79-05ef-5eb6-abaa-495445f22c44', 'fdd3332b-31d6-515c-b42d-020339010697', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('c0082e77-80b9-5c38-9c6c-99a191f2e956', '51f7c5ae-5126-590b-a1df-2036c5eff481', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('26849a1b-9974-550d-b32e-160e60b6731f', 'cfc735c5-ee10-5fa3-b7cf-03f959150f85', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('9f0ff643-2aa2-5983-951b-135501640559', '328ad48b-44ce-5054-a19c-29f33bdc475f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('b4e1f0c5-5cca-51e0-9bdd-b2b317b8bca9', '3a38f6d6-98ff-542b-a21b-5cacc9554f35', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('fc6dbc6b-a69b-5e22-a9e1-0231ef22aff0', '66426e03-cfc7-5905-9849-143c6a5402c6', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'rent', 'draft', NULL, 'import'),
  ('b794a641-16c1-522a-b39f-ce070950e4e1', 'fa5e3195-27dd-5777-a649-52a2c060fde1', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('3ecb9c79-c50d-5e8b-8fb9-dd366e805cb4', 'dc2c0024-1273-511f-84b4-3cc5439a1b7e', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('5393273d-1925-556f-8393-f1c38e99c982', '4bacb264-3918-5df6-9892-9185b2a75c16', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('0b3e2237-2aea-5630-b5b5-32ad92f6b07c', 'c2f45762-06b5-56e1-8fc8-fcf3e0f625a1', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'rent', 'draft', NULL, 'import'),
  ('7f5dda2a-4e94-503f-bb89-a103554fa263', '13aec35c-b256-5b34-bc35-70899f681713', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('acbd4a03-5668-5011-ba5d-79bd5a544935', '41fbcd10-447e-59e8-b63c-c99326cc89ad', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('7247fba2-6431-53a9-8096-e26cbefece07', 'e055dffd-3557-566e-b31b-9b88dbe6e9ed', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'sale', 'draft', NULL, 'import'),
  ('18a6cb42-6296-5574-aed2-d9feaf1658f3', '5a961027-fdf5-5006-ac40-b86407ac0747', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'rent', 'draft', NULL, 'import'),
  ('bc8d2c09-8f7b-577f-a289-ad9460dab353', 'fd2317e7-0098-5f0d-b53f-5122e1f9d517', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'rent', 'draft', NULL, 'import'),
  ('ba20514c-109b-5be2-9b95-1e1fb200cea8', '31c1fd6b-707d-58a9-a5f3-8ba6bbe46907', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'rent', 'draft', NULL, 'import'),
  ('326434e2-7f84-5064-ab7b-7909a2c78e08', '8d2fc0d2-e4f3-5fcb-b516-d6121805c765', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 'rent', 'draft', NULL, 'import')
ON CONFLICT (listing_id) DO NOTHING;

-- ---- 3. Draft revisions (contracts §4 public content only) ---------------
INSERT INTO public.listing_revisions (
  revision_id, listing_id, organization_id, base_revision_id, revision_state,
  title, description, property_type, property_subtype, availability,
  price_amount, price_currency, price_period,
  bedrooms, bathrooms, square_meters, lot_size_sqm, year_built,
  floor_number, total_floors, plot_dimensions, land_size_raw,
  area, city, town, county, country,
  amenities, furnished, created_by, created_via, published_at
) VALUES
  ('43ea096c-c282-58f7-8584-99ed0f5d953d', '303bc541-0768-534c-ad94-ca89522be640', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Executive 4-Bedroom All Ensuite Flat-Roof Maisonette at Hillview Gardens, Kantafu',
   'Executive 4-bedroom house for sale in Kantafu, Kangundo Road. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with borehole, backup generator, cctv, perimeter wall, electric fence. Price: KES 11,500,000. Perfect family residence in a secure, serene neighborhood.',
   'house', NULL, 'available',
   11500000, 'KES', 'one_time',
   4, 4, 220.0, 500.0, 2023,
   NULL, NULL, NULL, NULL,
   'Kantafu, Kangundo Road', 'Machakos', NULL, 'Machakos', 'Kenya',
   ARRAY['Borehole','Backup Generator','CCTV','Perimeter Wall','Electric Fence','Parking','Garden','Ready Title Deed','Gated Community','Solar Water Heating'], false, NULL, 'import', NULL),
  ('760eb9ea-5cea-5a4d-b430-afb78338340c', '48e6223f-3c13-56a7-aef2-ab1019ff4efa', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Custom-Built 3-Bedroom Bungalow with Private Perimeter Wall at Harmony Homes, Utawala',
   'Executive 3-bedroom house for sale in Utawala, Kangundo Road. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with borehole, backup generator, cctv, perimeter wall, electric fence. Price: KES 7,500,000. Perfect family residence in a secure, serene neighborhood.',
   'house', NULL, 'available',
   7500000, 'KES', 'one_time',
   3, 2, 130.0, 500.0, 2024,
   NULL, NULL, NULL, NULL,
   'Utawala, Kangundo Road', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['Borehole','Backup Generator','CCTV','Perimeter Wall','Electric Fence','Parking','Garden','Ready Title Deed','Gated Community','Solar Water Heating'], false, NULL, 'import', NULL),
  ('8ca5276f-6e3a-5376-8673-180f9b19f244', 'e7e270ab-2e70-504e-b26a-53acc222ee55', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Modern 3-Bedroom Master Ensuite Bungalow in Gated Court at Oasis Court, Utawala',
   'Executive 3-bedroom house for sale in Utawala, Kangundo Road. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with borehole, backup generator, cctv, perimeter wall, electric fence. Price: KES 5,100,000. Perfect family residence in a secure, serene neighborhood.',
   'house', NULL, 'available',
   5100000, 'KES', 'one_time',
   3, 2, 120.0, 500.0, 2024,
   NULL, NULL, NULL, NULL,
   'Utawala, Kangundo Road', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['Borehole','Backup Generator','CCTV','Perimeter Wall','Electric Fence','Parking','Garden','Ready Title Deed','Gated Community','Solar Water Heating'], false, NULL, 'import', NULL),
  ('de656908-61f7-5a20-bbe5-bc82baa6234b', '3d098a79-05ef-5eb6-abaa-495445f22c44', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Luxury 4-Bedroom Villa on 1/8 Acre with DSQ at Pride Park, Joska',
   'Executive 4-bedroom villa for sale in Joska, Kangundo Road. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with borehole, backup generator, cctv, perimeter wall, electric fence. Price: KES 14,000,000. Perfect family residence in a secure, serene neighborhood.',
   'villa', NULL, 'available',
   14000000, 'KES', 'one_time',
   4, 4, 250.0, 500.0, 2025,
   NULL, NULL, NULL, NULL,
   'Joska, Kangundo Road', 'Machakos', NULL, 'Machakos', 'Kenya',
   ARRAY['Borehole','Backup Generator','CCTV','Perimeter Wall','Electric Fence','Parking','Garden','Ready Title Deed','Gated Community','Solar Water Heating'], false, NULL, 'import', NULL),
  ('95de49f0-f5c7-5f55-b2b8-5af91b6d9a56', 'c0082e77-80b9-5c38-9c6c-99a191f2e956', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Modern 3-Bedroom Apartment in Kilimani',
   'Spacious modern apartment located in the heart of Kilimani. Features an open-plan living area, fully fitted kitchen with granite countertops, and large windows with natural light. The master bedroom has an en-suite bathroom with high-end fixtures. Complex offers 24/7 security, a swimming pool, gym, and covered parking. Close to Yaya Centre, hospitals, and schools.',
   'apartment', NULL, 'available',
   18500000, 'KES', 'one_time',
   3, 2, 180.0, 250.0, 2020,
   3, 5, NULL, NULL,
   'Kilimani', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['Pool','Gym','Parking','Security','Elevator'], false, NULL, 'import', NULL),
  ('80b85a21-eaaa-55bd-bfe6-893e8363e731', '26849a1b-9974-550d-b32e-160e60b6731f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Karen Brooks 5-Bedroom Luxury Villa on 0.5 Acre with Private Pool',
   'Spectacular 5-bedroom all-ensuite luxury villa set on a manicured half-acre in prime Karen. Features double-volume entrance foyer, grand fireplace in the sunken living room, gourmet island kitchen, private swimming pool, mature lush garden, 2-room staff quarters (DSQ), solar inverter system, borehole water, and 24/7 guarded barrier entrance.',
   'villa', NULL, 'available',
   95000000, 'KES', 'one_time',
   5, 6, 520.0, 2023.0, 2022,
   1, 2, NULL, NULL,
   'Karen', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['Swimming Pool','Garden','Backup Generator','Borehole','CCTV','Balcony','DSQ','Solar Water Heating','Fireplace','Security Guard','Parking'], false, NULL, 'import', NULL),
  ('9093056b-238e-541e-b4d4-5cdc8a247a9f', '9f0ff643-2aa2-5983-951b-135501640559', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '3 ac Land in Redhill',
   'Prime 3 ac Land in Redhill located in the high-growth area of Redhill. Ideal for immediate residential settlement or high-yield commercial/speculative investment. Features clean and ready freehold title deed, well-demarcated beacons, connected water and electricity, red soil suitable for construction and farming, and convenient access to the tarmac. Offered at KES 125,000,000. Flexible installment plans and site visits available.',
   'land', NULL, 'available',
   125000000.0, 'KES', 'one_time',
   NULL, NULL, NULL, 12140.58, NULL,
   NULL, NULL, NULL, '3.0 acres (approx. 12,141 m²)',
   'Redhill', 'Nairobi', NULL, 'Nairobi', 'Kenya',
   ARRAY['Garden','Balcony','Parking','DSQ'], false, NULL, 'import', NULL),
  ('570f6803-7d4b-5044-845a-1b285f5534dc', 'b4e1f0c5-5cca-51e0-9bdd-b2b317b8bca9', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '4 Bed Townhouse with En Suite in Ongata Rongai',
   'Executive 4-bedroom townhouse for sale in Ongata Rongai. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with cctv, fiber internet, swimming pool, borehole, gym. Price: KES 18,000,000. Perfect family residence in a secure, serene neighborhood.',
   'townhouse', NULL, 'available',
   18000000.0, 'KES', 'one_time',
   4, 4, 505.0, NULL, 2021,
   NULL, NULL, NULL, NULL,
   'Ongata Rongai', 'Nairobi', NULL, 'Kajiado', 'Kenya',
   ARRAY['CCTV','Fibre Internet','Swimming Pool','Borehole','Gym','Garden','Gated Community','Children''s Play Area','Backup Generator','Balcony','Parking','DSQ','Electric Fence'], false, NULL, 'import', NULL),
  ('996afa5b-2483-5454-9eae-60cd8eff2d2f', 'fc6dbc6b-a69b-5e22-a9e1-0231ef22aff0', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Spacious 2-Bedroom Apartment Master Ensuite in Joska, Kangundo Road',
   'Beautifully finished 2-bedroom apartment for rent in Joska, Kangundo Road. Highlights include well-lit living spaces, private balcony, fitted kitchen cabinets with granite tops, high-speed lifts, full backup generator, borehole water, and 24/7 CCTV surveillance. Key amenities: borehole, cctv, parking, balcony, fiber internet. Price: KES 23,500/month.',
   'apartment', NULL, 'available',
   23500, 'KES', 'per_month',
   2, 2, 75.0, NULL, 2024,
   1, 4, NULL, NULL,
   'Joska, Kangundo Road', 'Machakos', NULL, 'Machakos', 'Kenya',
   ARRAY['Borehole','CCTV','Parking','Balcony','Fibre Internet','Security Guard'], false, NULL, 'import', NULL),
  ('3f520a5a-89b2-56d6-831d-5dd5cdefa32a', 'b794a641-16c1-522a-b39f-ce070950e4e1', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '5 Bed Villa with En Suite at Galu',
   'Executive 5-bedroom villa for sale in Diani. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with swimming pool, parking, fiber internet, cctv, balcony. Price: KES 75,000,000. Perfect family residence in a secure, serene neighborhood.',
   'villa', NULL, 'available',
   75000000.0, 'KES', 'one_time',
   5, 6, NULL, NULL, 2023,
   NULL, NULL, NULL, NULL,
   'Diani', 'Kwale', NULL, 'Kwale', 'Kenya',
   ARRAY['Swimming Pool','Parking','Fibre Internet','CCTV','Balcony','Electric Fence','Backup Generator','DSQ','Gym','Garden','Borehole'], false, NULL, 'import', NULL),
  ('53821aac-eb08-5b4b-87f8-be80a6635b83', '3ecb9c79-c50d-5e8b-8fb9-dd366e805cb4', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '3 Bed Townhouse with En Suite at Kagundo Road',
   'Executive 3-bedroom townhouse for sale in Joska. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with parking, cctv, kids play area, gated community, electric fence. Price: KES 8,950,000. Perfect family residence in a secure, serene neighborhood.',
   'townhouse', NULL, 'available',
   8950000.0, 'KES', 'one_time',
   3, 4, 163.0, NULL, 2023,
   NULL, NULL, NULL, NULL,
   'Joska', 'Nairobi', NULL, 'Machakos', 'Kenya',
   ARRAY['Parking','CCTV','Children''s Play Area','Gated Community','Electric Fence','Backup Generator','DSQ','Gym','Garden','Borehole'], false, NULL, 'import', NULL),
  ('642786bf-b18c-599b-8251-2dcaa683b62c', '5393273d-1925-556f-8393-f1c38e99c982', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Serviced 3 Bed Apartment with En Suite at Nyali',
   'Beautifully finished 3-bedroom apartment for sale in Nyali. Highlights include well-lit living spaces, private balcony, fitted kitchen cabinets with granite tops, high-speed lifts, full backup generator, borehole water, and 24/7 CCTV surveillance. Key amenities: cctv, high speed lift, fiber internet, swimming pool, gym. Price: KES 9,500,000.',
   'apartment', NULL, 'available',
   9500000.0, 'KES', 'one_time',
   3, 3, 170.0, NULL, 2020,
   2, 12, NULL, NULL,
   'Nyali', 'Mombasa', NULL, 'Mombasa', 'Kenya',
   ARRAY['CCTV','High-Speed Lift','Fibre Internet','Swimming Pool','Gym','Garden','Backup Generator','Balcony','Parking','Electric Fence'], false, NULL, 'import', NULL),
  ('4639986c-2cd7-5239-ada3-b573000c5432', '0b3e2237-2aea-5630-b5b5-32ad92f6b07c', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   'Modern 1-Bedroom Apartment with Balcony in Kantafu, Kangundo Road',
   'Beautifully finished 1-bedroom apartment for rent in Kantafu, Kangundo Road. Highlights include well-lit living spaces, private balcony, fitted kitchen cabinets with granite tops, high-speed lifts, full backup generator, borehole water, and 24/7 CCTV surveillance. Key amenities: borehole, cctv, parking, balcony, fiber internet. Price: KES 10,500/month.',
   'apartment', NULL, 'available',
   10500, 'KES', 'per_month',
   1, 1, 45.0, NULL, 2022,
   1, 4, NULL, NULL,
   'Kantafu, Kangundo Road', 'Machakos', NULL, 'Machakos', 'Kenya',
   ARRAY['Borehole','CCTV','Parking','Balcony','Fibre Internet','Security Guard'], false, NULL, 'import', NULL),
  ('b729f41d-50f8-591a-9419-8db7a7ee6298', '7f5dda2a-4e94-503f-bb89-a103554fa263', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '506 m² Land in Nyali Area',
   'Prime 506 m² Land in Nyali Area located in the high-growth area of Nyali. Ideal for immediate residential settlement or high-yield commercial/speculative investment. Features clean and ready freehold title deed, well-demarcated beacons, connected water and electricity, red soil suitable for construction and farming, and convenient access to the tarmac. Offered at KES 15,000,000. Flexible installment plans and site visits available.',
   'land', NULL, 'available',
   15000000.0, 'KES', 'one_time',
   NULL, NULL, NULL, 506.0, NULL,
   NULL, NULL, NULL, '506 m²',
   'Nyali', 'Mombasa', NULL, 'Mombasa', 'Kenya',
   ARRAY['CCTV','Parking','Borehole'], false, NULL, 'import', NULL),
  ('4153c2e7-4153-5b98-a6dd-cbf7abe2de1d', 'acbd4a03-5668-5011-ba5d-79bd5a544935', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '9.603 ac Land in Juja',
   'Prime 9.603 ac Land in Juja located in the high-growth area of Juja. Ideal for immediate residential settlement or high-yield commercial/speculative investment. Features clean and ready freehold title deed, well-demarcated beacons, connected water and electricity, red soil suitable for construction and farming, and convenient access to the tarmac. Offered at KES 145,000,000. Flexible installment plans and site visits available.',
   'land', NULL, 'available',
   145000000.0, 'KES', 'one_time',
   NULL, NULL, NULL, 38862.0, NULL,
   NULL, NULL, NULL, '9.603 acres (approx. 38,862 m²)',
   'Juja', 'Nairobi', NULL, 'Kiambu', 'Kenya',
   ARRAY['Parking','Borehole','CCTV'], false, NULL, 'import', NULL),
  ('6042415c-5a65-588a-a073-8a253b5235fe', '7247fba2-6431-53a9-8096-e26cbefece07', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '2 Bed Apartment with En Suite at Nyali',
   'Beautifully finished 2-bedroom apartment for sale in Nyali. Highlights include well-lit living spaces, private balcony, fitted kitchen cabinets with granite tops, high-speed lifts, full backup generator, borehole water, and 24/7 CCTV surveillance. Key amenities: swimming pool, parking, fiber internet, high speed lift, cctv. Price: KES 18,000,000.',
   'apartment', NULL, 'available',
   18000000.0, 'KES', 'one_time',
   2, 3, 134.0, NULL, 2023,
   1, 12, NULL, NULL,
   'Nyali', 'Mombasa', NULL, 'Mombasa', 'Kenya',
   ARRAY['Swimming Pool','Parking','Fibre Internet','High-Speed Lift','CCTV','Balcony','Children''s Play Area','Gated Community','Electric Fence','Backup Generator','DSQ','Gym','Garden','Borehole'], false, NULL, 'import', NULL),
  ('f7c575ad-8d7e-505f-a0c4-f6e62f3ec0c5', '18a6cb42-6296-5574-aed2-d9feaf1658f3', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '4 Bed House with En Suite at Off Paradise Lost Road',
   'Executive 4-bedroom house for rent in Kiambu Road. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with cctv, electric fence, borehole, garden, gated community. Price: KES 270,000/month. Perfect family residence in a secure, serene neighborhood.',
   'house', NULL, 'available',
   270000.0, 'KES', 'per_month',
   4, 4, 180.0, NULL, 2020,
   NULL, NULL, NULL, NULL,
   'Kiambu Road', 'Nairobi', NULL, 'Kiambu', 'Kenya',
   ARRAY['CCTV','Electric Fence','Borehole','Garden','Gated Community','Children''s Play Area','Fibre Internet','Balcony','Parking','DSQ'], false, NULL, 'import', NULL),
  ('89c496cd-1df4-59fa-80a3-b98d84ce57b5', 'bc8d2c09-8f7b-577f-a289-ad9460dab353', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '4 Bed Townhouse with Staff Quarters at Ineza',
   'Executive 4-bedroom townhouse for rent in Kiambu Road. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with parking, kids play area, gated community, electric fence, dsq. Price: KES 279,000/month. Perfect family residence in a secure, serene neighborhood.',
   'townhouse', NULL, 'available',
   279000.0, 'KES', 'per_month',
   4, 4, 217.3, NULL, 2023,
   NULL, NULL, NULL, NULL,
   'Kiambu Road', 'Nairobi', NULL, 'Kiambu', 'Kenya',
   ARRAY['Parking','Children''s Play Area','Gated Community','Electric Fence','DSQ','Garden','Borehole'], false, NULL, 'import', NULL),
  ('3e92e778-ad66-52b7-87ef-db42355d9300', 'ba20514c-109b-5be2-9b95-1e1fb200cea8', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '3 Bed Apartment with En Suite at Nyali',
   'Beautifully finished 3-bedroom apartment for rent in Nyali. Highlights include well-lit living spaces, private balcony, fitted kitchen cabinets with granite tops, high-speed lifts, full backup generator, borehole water, and 24/7 CCTV surveillance. Key amenities: parking, electric fence. Price: KES 72,500/month.',
   'apartment', NULL, 'available',
   72500.0, 'KES', 'per_month',
   3, 4, 224.8, NULL, 2022,
   5, 12, NULL, NULL,
   'Nyali', 'Mombasa', NULL, 'Mombasa', 'Kenya',
   ARRAY['Parking','Electric Fence'], false, NULL, 'import', NULL),
  ('94e71193-4915-539d-b808-a9f23c6b7b9a', '326434e2-7f84-5064-ab7b-7909a2c78e08', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', NULL, 'draft',
   '4 Bed Villa with En Suite in Kiambu Road',
   'Executive 4-bedroom villa for rent in Kiambu Road. Designed with contemporary architectural finesse featuring an expansive living room, modern open-plan fitted kitchen with pantry, master ensuite with walk-in closet, private landscaped garden, and perimeter wall with electric fencing. Equipped with swimming pool, parking, fiber internet, cctv, balcony. Price: KES 260,000/month. Perfect family residence in a secure, serene neighborhood.',
   'villa', NULL, 'available',
   260000.0, 'KES', 'per_month',
   4, 5, 300.0, NULL, 2024,
   NULL, NULL, NULL, NULL,
   'Kiambu Road', 'Nairobi', NULL, 'Kiambu', 'Kenya',
   ARRAY['Swimming Pool','Parking','Fibre Internet','CCTV','Balcony','Children''s Play Area','Gated Community','Electric Fence','Backup Generator','DSQ','Gym','Garden','Borehole'], false, NULL, 'import', NULL)
ON CONFLICT (revision_id) DO NOTHING;

-- ---- 4. Media rows (inherited_external references, hidden until Phase 3) --
INSERT INTO public.listing_media (
  media_id, revision_id, organization_id, position, kind, is_featured,
  source, inherited_url, original_path, derivative_paths,
  processing_status, moderation_status, content_hash
) VALUES
  ('f2d6642a-fe7c-5cb9-a6d5-a155d2023cda', '43ea096c-c282-58f7-8584-99ed0f5d953d', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1598228723793-52759bba239c?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('a02094f4-dc4f-5e3f-8ecb-7eb3b3c0b103', '43ea096c-c282-58f7-8584-99ed0f5d953d', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('26420c65-3516-5b7b-938c-f0f9c6e6e842', '43ea096c-c282-58f7-8584-99ed0f5d953d', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('fff4766e-f6aa-5a61-b8c0-ce2e132c87eb', '760eb9ea-5cea-5a4d-b430-afb78338340c', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1588880331179-bc9b93a8cb5e?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('4f9749bb-be5e-5f54-956e-934832fb91ff', '760eb9ea-5cea-5a4d-b430-afb78338340c', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('16017da5-de1e-57ef-92ae-7867e5a4797f', '760eb9ea-5cea-5a4d-b430-afb78338340c', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1598228723793-52759bba239c?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('c3d8a542-af00-5f2b-b50c-560f4847e460', '8ca5276f-6e3a-5376-8673-180f9b19f244', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('7d2601dc-b106-5de3-a8e4-a5278466e72a', '8ca5276f-6e3a-5376-8673-180f9b19f244', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1588880331179-bc9b93a8cb5e?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('4765230b-ec31-5021-b0ad-b00363bd86b8', '8ca5276f-6e3a-5376-8673-180f9b19f244', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1598228723793-52759bba239c?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('02e89524-6582-5a95-8d21-c9a08c22bdb6', 'de656908-61f7-5a20-bbe5-bc82baa6234b', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('4fb47968-334f-54a8-b4c7-8022c56e2ae5', 'de656908-61f7-5a20-bbe5-bc82baa6234b', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('71ef46c6-6603-57ea-97da-65b0cbd3cc0a', 'de656908-61f7-5a20-bbe5-bc82baa6234b', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('539abbba-657e-5978-9473-0cfdce973d67', '95de49f0-f5c7-5f55-b2b8-5af91b6d9a56', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://example.com/images/kilimani-1.jpg', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('2b9a4f00-3f1b-5e82-911a-6c683f79a4f7', '95de49f0-f5c7-5f55-b2b8-5af91b6d9a56', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://example.com/images/kilimani-2.jpg', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('06ce8005-34da-5c98-952a-31713a5483e4', '95de49f0-f5c7-5f55-b2b8-5af91b6d9a56', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://example.com/images/kilimani-3.jpg', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('c74e587b-3d7c-5b45-a7f2-9c743ff5e699', '80b85a21-eaaa-55bd-bfe6-893e8363e731', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('70e1e954-d006-5a95-a708-8910347a3a0f', '80b85a21-eaaa-55bd-bfe6-893e8363e731', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('093d00bd-6c57-5d94-a646-ff121d520e01', '80b85a21-eaaa-55bd-bfe6-893e8363e731', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('8f08614b-b5d5-5097-b138-e8f52e973188', '80b85a21-eaaa-55bd-bfe6-893e8363e731', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 3, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('6c6191ed-4dec-5a76-b12e-310243306342', '9093056b-238e-541e-b4d4-5cdc8a247a9f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('7f4ceacf-01ab-5e98-aaec-40d2ae4f5528', '9093056b-238e-541e-b4d4-5cdc8a247a9f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('30f7498e-1c79-5787-acc4-efe183378955', '9093056b-238e-541e-b4d4-5cdc8a247a9f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('6455891b-7419-555f-b924-520718950110', '570f6803-7d4b-5044-845a-1b285f5534dc', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('a55c2c7f-ee9d-5a4e-8d7b-837dea17d79c', '570f6803-7d4b-5044-845a-1b285f5534dc', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('8544a6c2-3556-5c3c-a2b0-1c65f116ba93', '570f6803-7d4b-5044-845a-1b285f5534dc', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('2f7ac99d-9d4d-5936-85df-3899561f8e82', '996afa5b-2483-5454-9eae-60cd8eff2d2f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('761e60c8-ba16-5d06-997a-f1bd2ed1b557', '996afa5b-2483-5454-9eae-60cd8eff2d2f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1567496898669-ee935f5f647a?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('77f19a03-325f-54ad-a087-4400aab2f416', '996afa5b-2483-5454-9eae-60cd8eff2d2f', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('fe503c93-be9a-5eaf-b9ae-9298bb781981', '3f520a5a-89b2-56d6-831d-5dd5cdefa32a', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('1d13ce55-1edb-5078-a2fe-bb73bee16f6b', '3f520a5a-89b2-56d6-831d-5dd5cdefa32a', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('ed6fe113-809a-5094-94b7-f0f8ab69f4af', '3f520a5a-89b2-56d6-831d-5dd5cdefa32a', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('7ff17341-bd80-5aa6-b633-a3ac32eadfae', '53821aac-eb08-5b4b-87f8-be80a6635b83', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('beef158a-1b96-5205-ba71-30400d64ffac', '53821aac-eb08-5b4b-87f8-be80a6635b83', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('0897119f-bd3e-5aaa-87e3-574b1c26dd36', '53821aac-eb08-5b4b-87f8-be80a6635b83', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('58aae03f-86a8-5878-a370-78e0339c47c6', '642786bf-b18c-599b-8251-2dcaa683b62c', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('b1cba912-6e11-5529-a7ff-fc1329f4592b', '642786bf-b18c-599b-8251-2dcaa683b62c', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('089900b3-eca0-535b-b4f2-89bd51c592ee', '642786bf-b18c-599b-8251-2dcaa683b62c', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('ecbb59a9-e26f-5a35-8dae-11f998bb36b4', '4639986c-2cd7-5239-ada3-b573000c5432', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('20afbf87-f52a-5688-9d79-64cad4dd28e8', '4639986c-2cd7-5239-ada3-b573000c5432', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('017dab78-145f-52ee-9577-528165bf9cce', '4639986c-2cd7-5239-ada3-b573000c5432', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('c44d2c9a-763c-5da5-9efe-0cdcffe27684', 'b729f41d-50f8-591a-9419-8db7a7ee6298', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1500651230702-0e2d8a49d4ad?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('0e8df1ca-b5ab-5d33-b909-6065de397527', 'b729f41d-50f8-591a-9419-8db7a7ee6298', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1470240731273-7821a6eeb6bd?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('9f1deab9-1403-5ca2-8fed-ca66461cafd5', 'b729f41d-50f8-591a-9419-8db7a7ee6298', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('f447808e-6802-528d-b1e0-daf028631765', '4153c2e7-4153-5b98-a6dd-cbf7abe2de1d', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1500651230702-0e2d8a49d4ad?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('8bca40ab-f2f3-5dc8-a991-856a9f92cd7b', '4153c2e7-4153-5b98-a6dd-cbf7abe2de1d', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('3ffc0e7e-9dea-508a-831c-3868fa89ae6c', '4153c2e7-4153-5b98-a6dd-cbf7abe2de1d', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('b808d438-e2f1-5529-82d0-fa71156e38a7', '6042415c-5a65-588a-a073-8a253b5235fe', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('6b42d3b7-f737-55df-84ce-26c5a45b9408', '6042415c-5a65-588a-a073-8a253b5235fe', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('8196d5e3-8598-5b68-9a82-92faed18a337', '6042415c-5a65-588a-a073-8a253b5235fe', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1567496898669-ee935f5f647a?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('1bb360f7-df33-5a1c-b03d-8a0ac60352df', 'f7c575ad-8d7e-505f-a0c4-f6e62f3ec0c5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1588880331179-bc9b93a8cb5e?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('0e5b95aa-ee77-59f5-bdbb-479d9f65385c', 'f7c575ad-8d7e-505f-a0c4-f6e62f3ec0c5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('a2b8a913-7a0c-5d32-a630-2afa7a68d4d0', 'f7c575ad-8d7e-505f-a0c4-f6e62f3ec0c5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('e03d0197-2fce-519a-baf3-14e9fe67f092', '89c496cd-1df4-59fa-80a3-b98d84ce57b5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('2ebdcc8a-d81d-50b7-9371-e9507d5415f8', '89c496cd-1df4-59fa-80a3-b98d84ce57b5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('e216359a-300f-5dc8-aaa6-9569dd0dedb4', '89c496cd-1df4-59fa-80a3-b98d84ce57b5', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('035e29d3-0974-5232-898b-2a4fa431a958', '3e92e778-ad66-52b7-87ef-db42355d9300', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1567496898669-ee935f5f647a?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('2e8abd0a-8056-5363-b882-eeea9c427fda', '3e92e778-ad66-52b7-87ef-db42355d9300', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('375e3a12-d474-58ae-8eee-17a1f597914c', '3e92e778-ad66-52b7-87ef-db42355d9300', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('f8aa8a16-6d5c-5128-9596-c5b22e5b0440', '94e71193-4915-539d-b808-a9f23c6b7b9a', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 0, 'image', true,
   'inherited_external', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('a21c74ba-16e0-5cd7-b26d-febbc72d6f93', '94e71193-4915-539d-b808-a9f23c6b7b9a', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 1, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL),
  ('2781af77-f708-58a5-ad02-9566073634bf', '94e71193-4915-539d-b808-a9f23c6b7b9a', '9b2bd10f-0d6a-56a3-ba53-fafb72482627', 2, 'image', false,
   'inherited_external', 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200', NULL, NULL,
   'pending', 'unreviewed', NULL)
ON CONFLICT (revision_id, position) DO NOTHING;

-- ---- 5. Lifecycle walk (scoped to the import org only) -------------------
SET LOCAL luxonn.domain_command = 'on';

UPDATE public.listing_revisions
SET revision_state = 'published',
    published_at   = now(),
    updated_at     = now()
WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627'
  AND revision_state  = 'draft';

UPDATE public.listings l
SET lifecycle_state       = 'published',
    published_revision_id = r.revision_id,
    updated_at            = now()
FROM public.listing_revisions r
WHERE r.listing_id = l.listing_id
  AND r.revision_state = 'published'
  AND l.lifecycle_state = 'draft'
  AND l.organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627';

COMMIT;

-- ---- Verification (run separately; expected: 20 / 20 / 61 / 30) ------
-- SELECT count(*) FROM public.listing_revisions
--  WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627' AND revision_state = 'published';
-- SELECT count(*) FROM public.listings
--  WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627' AND lifecycle_state = 'published'
--    AND published_revision_id IS NOT NULL;
-- SELECT count(*) FROM public.listing_media
--  WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627' AND processing_status = 'pending';
-- SELECT count(*) FROM public.listings;  -- as anon: must equal 30 (RLS gate)

-- ---- Purge (run alone when real inventory replaces the import) -----------
-- BEGIN;
-- DELETE FROM public.listing_media     WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627';
-- DELETE FROM public.listing_revisions WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627';
-- DELETE FROM public.listings          WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627';
-- DELETE FROM public.properties_lux    WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627';
-- DELETE FROM public.owner_organizations WHERE organization_id = '9b2bd10f-0d6a-56a3-ba53-fafb72482627';
-- COMMIT;