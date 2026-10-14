/**
 * Kenya-Focused Retrieval & Search Evaluation Dataset
 *
 * Implements Phase 5 Step 1 of the LUXONN marketplace implementation sequence.
 * Provides labeled natural language buyer queries, intent categorization, structured
 * filter constraints, and graded relevance assessments across canonical inventory.
 *
 * Relevance Scale:
 *   2 = Highly Relevant (exact match for location, typology, and key constraints)
 *   1 = Partially Relevant (satisfies several criteria or serves as a viable alternative)
 *   0 = Irrelevant (violates core constraints or wrong geographic region)
 */

export interface LabeledQuery {
  id: string;
  query: string;
  intentCategory:
    | 'neighborhood_luxury'
    | 'high_density_urban'
    | 'gated_compound'
    | 'coastal_retreat'
    | 'land_development'
    | 'shortlet_and_rental'
    | 'scenic_lifestyle';
  filters?: {
    city?: string;
    area?: string;
    property_type?: string;
    min_bedrooms?: number;
    max_price?: number;
    amenities?: string[];
  };
  groundTruth: Record<string, 0 | 1 | 2>;
  expectedTopListingId: string;
  notes: string;
}

export const KENYA_RETRIEVAL_BENCHMARK: LabeledQuery[] = [
  {
    id: 'eval-01',
    query: 'Luxury 5 bedroom standalone villa in Karen with private pool and garden',
    intentCategory: 'neighborhood_luxury',
    filters: {
      city: 'Nairobi',
      area: 'Karen',
      property_type: 'villa',
      min_bedrooms: 5,
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b01': 2, // Karen 5-bed villa on half acre
      '26849a1b-9974-550d-b32e-160e60b6731f': 2, // Karen Brooks 5-bed villa with pool
      '00000000-0000-0000-0000-000000000b02': 1, // Runda 4-bed townhouse (alternative luxury)
      '00000000-0000-0000-0000-000000000b04': 1, // Lavington 4-bed townhouse
      '00000000-0000-0000-0000-000000000b03': 0, // Westlands apartment
    },
    expectedTopListingId: '26849a1b-9974-550d-b32e-160e60b6731f',
    notes: 'Requires high-value Karen villas with 5 bedrooms, lush outdoor grounds, and pool/borehole amenities.',
  },
  {
    id: 'eval-02',
    query: 'High floor apartment with panoramic views in Westlands with gym and pool',
    intentCategory: 'high_density_urban',
    filters: {
      city: 'Nairobi',
      area: 'Westlands',
      property_type: 'apartment',
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b03': 2, // Westlands 3-bed 8th floor rift views
      '00000000-0000-0000-0000-000000000b07': 1, // Westlands furnished 2-bed near Sarit
      'c0082e77-80b9-5c38-9c6c-99a191f2e956': 1, // Kilimani 3-bed apartment
      '00000000-0000-0000-0000-000000000b01': 0, // Karen villa
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b03',
    notes: 'Matches elevated Westlands residence with gym, pool, generator, and Rift Valley views.',
  },
  {
    id: 'eval-03',
    query: 'Secure townhouse in a quiet gated community in Runda',
    intentCategory: 'gated_compound',
    filters: {
      city: 'Nairobi',
      area: 'Runda',
      property_type: 'townhouse',
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b02': 2, // Runda 4-bed in gated court of 6
      '00000000-0000-0000-0000-000000000b04': 1, // Lavington townhouse on quiet lane
      'bc8d2c09-8f7b-577f-a289-ad9460dab353': 1, // Kiambu Road townhouse with staff quarters
      '00000000-0000-0000-0000-000000000b05': 0, // Runda plot (land, not residential home)
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b02',
    notes: 'Direct match for gated community enclave in Runda.',
  },
  {
    id: 'eval-04',
    query: 'Beachfront or ocean-view luxury villa in Diani or Nyali with plunge pool',
    intentCategory: 'coastal_retreat',
    filters: {
      property_type: 'villa',
    },
    groundTruth: {
      'b794a641-16c1-522a-b39f-ce070950e4e1': 2, // 5 Bed Villa at Galu Diani
      '00000000-0000-0000-0000-000000000b08': 2, // Nyali 4-Bed Swahili-Style Villa near the reef
      '5393273d-1925-556f-8393-f1c38e99c982': 1, // Serviced 3-bed Nyali apartment
      '7247fba2-6431-53a9-8096-e26cbefece07': 1, // 2-bed Nyali apartment
      '00000000-0000-0000-0000-000000000b01': 0, // Nairobi inland villa
    },
    expectedTopListingId: 'b794a641-16c1-522a-b39f-ce070950e4e1',
    notes: 'Coastal luxury focus across Kwale/Diani and Mombasa/Nyali.',
  },
  {
    id: 'eval-05',
    query: 'Half-acre or larger prime residential development land in Runda or Redhill',
    intentCategory: 'land_development',
    filters: {
      property_type: 'land',
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b05': 2, // Runda half-acre level plot
      '9f0ff643-2aa2-5983-951b-135501640559': 2, // 3 ac Land in Redhill
      'acbd4a03-5668-5011-ba5d-79bd5a544935': 1, // 9.6 ac Land in Juja
      '7f5dda2a-4e94-503f-bb89-a103554fa263': 1, // 506 sqm Land in Nyali
      '00000000-0000-0000-0000-000000000b02': 0, // Built townhouse
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b05',
    notes: 'Evaluates land typology and zoning queries with strict non-building classification.',
  },
  {
    id: 'eval-06',
    query: 'Executive family townhouse on a quiet street in Lavington with garden and DSQ',
    intentCategory: 'gated_compound',
    filters: {
      city: 'Nairobi',
      area: 'Lavington',
      property_type: 'townhouse',
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b04': 2, // Lavington 4-bed townhouse on quiet lane
      '00000000-0000-0000-0000-000000000b02': 1, // Runda townhouse
      'b4e1f0c5-5cca-51e0-9bdd-b2b317b8bca9': 1, // Ongata Rongai townhouse
      '00000000-0000-0000-0000-000000000b06': 0, // Kilimani apartment
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b04',
    notes: 'Targeted Lavington family residence with garden, annexe, and perimeter security.',
  },
  {
    id: 'eval-07',
    query: 'Furnished serviced executive apartment in Westlands near shopping amenities',
    intentCategory: 'shortlet_and_rental',
    filters: {
      city: 'Nairobi',
      area: 'Westlands',
      property_type: 'apartment',
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b07': 2, // Westlands furnished 2-bed near Sarit
      '00000000-0000-0000-0000-000000000b03': 1, // Westlands 3-bed unfurnished
      '00000000-0000-0000-0000-000000000b10': 1, // Kilimani furnished shortlet
      '00000000-0000-0000-0000-000000000b01': 0, // Karen villa
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b07',
    notes: 'Requires furnished status, housekeeping/serviced amenities, and Westlands location.',
  },
  {
    id: 'eval-08',
    query: 'Scenic lakeside sanctuary or holiday retreat in Naivasha with fireplace',
    intentCategory: 'scenic_lifestyle',
    filters: {
      city: 'Naivasha',
      property_type: 'house',
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b09': 2, // Naivasha 3-bed lake-view on an acre
      '00000000-0000-0000-0000-000000000b08': 1, // Nyali villa (coastal retreat alternative)
      '00000000-0000-0000-0000-000000000b01': 0, // Nairobi suburban villa
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b09',
    notes: 'Great Rift Valley retreat with lake view and acreage.',
  },
  {
    id: 'eval-09',
    query: '4 bedroom modern house along Kiambu Road with staff quarters and ensuite rooms',
    intentCategory: 'neighborhood_luxury',
    filters: {
      city: 'Nairobi',
      area: 'Kiambu Road',
      min_bedrooms: 4,
    },
    groundTruth: {
      '18a6cb42-6296-5574-aed2-d9feaf1658f3': 2, // Kiambu Road 4 bed house with en suite
      '326434e2-7f84-5064-ab7b-7909a2c78e08': 2, // Kiambu Road 4 bed villa
      'bc8d2c09-8f7b-577f-a289-ad9460dab353': 2, // Kiambu Road 4 bed townhouse with staff quarters
      '00000000-0000-0000-0000-000000000b02': 1, // Runda 4-bed townhouse
      '00000000-0000-0000-0000-000000000b06': 0, // Kilimani apartment
    },
    expectedTopListingId: 'bc8d2c09-8f7b-577f-a289-ad9460dab353',
    notes: 'Kiambu Road luxury corridor with en-suite bedrooms and staff accommodation.',
  },
  {
    id: 'eval-10',
    query: 'Contemporary 3 bedroom apartment in Kilimani near Yaya Centre with balcony and elevator',
    intentCategory: 'high_density_urban',
    filters: {
      city: 'Nairobi',
      area: 'Kilimani',
      property_type: 'apartment',
      min_bedrooms: 3,
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b06': 2, // Kilimani 3-bed steps from Yaya Centre
      'c0082e77-80b9-5c38-9c6c-99a191f2e956': 2, // Modern 3-bed in Kilimani
      '00000000-0000-0000-0000-000000000b10': 1, // Kilimani 1-bed shortlet
      '00000000-0000-0000-0000-000000000b03': 1, // Westlands 3-bed apartment
      '00000000-0000-0000-0000-000000000b01': 0, // Karen villa
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b06',
    notes: 'Urban Kilimani lifestyle near major shopping centres with lift and balcony.',
  },
  {
    id: 'eval-11',
    query: 'Affordable modern bungalow or maisonette along Kangundo Road Joska or Utawala',
    intentCategory: 'neighborhood_luxury',
    filters: {
      property_type: 'house',
    },
    groundTruth: {
      '303bc541-0768-534c-ad94-ca89522be640': 2, // Hillview Gardens Kantafu 4-bed maisonette
      '3d098a79-05ef-5eb6-abaa-495445f22c44': 2, // Pride Park Joska 4-bed villa with DSQ
      '48e6223f-3c13-56a7-aef2-ab1019ff4efa': 2, // Harmony Homes Utawala 3-bed bungalow
      'e7e270ab-2e70-504e-b26a-53acc222ee55': 2, // Oasis Court Utawala 3-bed bungalow
      '3ecb9c79-c50d-5e8b-8fb9-dd366e805cb4': 1, // Joska 3-bed townhouse
      '00000000-0000-0000-0000-000000000b01': 0, // Karen multi-million luxury villa
    },
    expectedTopListingId: '3d098a79-05ef-5eb6-abaa-495445f22c44',
    notes: 'Eastern Nairobi / Machakos growth corridor with standalone compound and perimeter wall.',
  },
  {
    id: 'eval-12',
    query: 'Furnished shortlet studio or 1 bedroom apartment in Kilimani near shopping and transit',
    intentCategory: 'shortlet_and_rental',
    filters: {
      city: 'Nairobi',
      area: 'Kilimani',
      property_type: 'apartment',
    },
    groundTruth: {
      '00000000-0000-0000-0000-000000000b10': 2, // Kilimani furnished 1-bed shortlet near Prestige
      '00000000-0000-0000-0000-000000000b07': 1, // Westlands furnished 2-bed
      '0b3e2237-2aea-5630-b5b5-32ad92f6b07c': 1, // Kantafu 1-bed
      '00000000-0000-0000-0000-000000000b01': 0, // Karen villa
    },
    expectedTopListingId: '00000000-0000-0000-0000-000000000b10',
    notes: 'Short-term flexible stay in Kilimani with wifi and housekeeping included.',
  },
];
