import { createHash } from 'crypto';

export interface AssembledDocument {
  recipeVersion: string;
  contentHash: string;
  documentText: string;
  fieldsUsed: string[];
}

export interface BuyerSafeRevisionInput {
  revision_id: string;
  listing_id: string;
  title: string;
  description: string;
  property_type: string;
  property_subtype?: string | null;
  availability?: string | null;
  price_amount: number | string;
  price_currency: string;
  price_period?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  square_meters?: number | null;
  lot_size_sqm?: number | null;
  year_built?: number | null;
  area: string;
  city: string;
  town?: string | null;
  county?: string | null;
  country: string;
  amenities?: string[] | null;
  furnished?: boolean | null;
  visualCaptions?: string[] | null;
}

export const CURRENT_RECIPE_VERSION = 'v1_buyer_safe_kenya';

/**
 * Strictly forbidden fields per ADR-014 (Security and Data Boundaries)
 * These must never be assembled into vector projections or buyer-facing documents.
 */
export const RESTRICTED_FORBIDDEN_FIELDS = [
  'exact_address',
  'address',
  'latitude',
  'longitude',
  'contact_phone',
  'contact_email',
  'owner_phone',
  'owner_email',
  'reporter_phone',
  'reporter_email',
  'status_token_hash',
] as const;

/**
 * Assembles a buyer-safe textual representation of a published Kenyan residence
 * suitable for deterministic vector embedding and retrieval evaluation.
 *
 * Guaranteed invariants:
 * 1. Zero leakage of private coordinates, exact street addresses, or contact information.
 * 2. Deterministic whitespace normalization.
 * 3. SHA-256 cryptographic content hash matching exact payload bytes.
 */
export function assembleBuyerSafeDocument(
  rev: BuyerSafeRevisionInput,
  recipeVersion = CURRENT_RECIPE_VERSION
): AssembledDocument {
  const lines: string[] = [];
  const fieldsUsed: string[] = [];

  // 1. Headline & Classification
  lines.push(`Title: ${rev.title.trim()}`);
  fieldsUsed.push('title');

  const typeDesc = [rev.property_type, rev.property_subtype]
    .filter(Boolean)
    .join(' / ');
  lines.push(`Property Type: ${typeDesc}`);
  fieldsUsed.push('property_type');

  if (rev.availability) {
    lines.push(`Availability: ${rev.availability}`);
    fieldsUsed.push('availability');
  }

  // 2. Financial Terms
  const amountNum = typeof rev.price_amount === 'string' ? parseFloat(rev.price_amount) : rev.price_amount;
  const formattedAmount = isNaN(amountNum) ? rev.price_amount : amountNum.toLocaleString('en-KE');
  const period = rev.price_period ? ` (${rev.price_period})` : '';
  lines.push(`Price: ${rev.price_currency} ${formattedAmount}${period}`);
  fieldsUsed.push('price_amount', 'price_currency');

  // 3. Physical Attributes
  const specs: string[] = [];
  if (rev.bedrooms !== null && rev.bedrooms !== undefined) specs.push(`${rev.bedrooms} bedrooms`);
  if (rev.bathrooms !== null && rev.bathrooms !== undefined) specs.push(`${rev.bathrooms} bathrooms`);
  if (rev.square_meters) specs.push(`${rev.square_meters} sqm built area`);
  if (rev.lot_size_sqm) specs.push(`${rev.lot_size_sqm} sqm plot / land`);
  if (rev.year_built) specs.push(`Built ${rev.year_built}`);
  if (rev.furnished !== null && rev.furnished !== undefined) {
    specs.push(rev.furnished ? 'Furnished' : 'Unfurnished');
  }
  if (specs.length > 0) {
    lines.push(`Specifications: ${specs.join(', ')}`);
    fieldsUsed.push('bedrooms', 'bathrooms', 'square_meters', 'lot_size_sqm', 'year_built', 'furnished');
  }

  // 4. Area & Geographic Scope (Strictly Public Level Only)
  const geoParts = [rev.area, rev.town, rev.city, rev.county, rev.country]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx);
  lines.push(`Location: ${geoParts.join(', ')}`);
  fieldsUsed.push('area', 'city', 'town', 'county', 'country');

  // 5. Verified Amenities
  if (rev.amenities && rev.amenities.length > 0) {
    lines.push(`Amenities: ${rev.amenities.join(', ')}`);
    fieldsUsed.push('amenities');
  }

  // 6. Editorial Description
  if (rev.description) {
    lines.push(`Description:\n${rev.description.trim()}`);
    fieldsUsed.push('description');
  }

  // 7. Optional Visual Captions
  if (rev.visualCaptions && rev.visualCaptions.length > 0) {
    lines.push(`Visual Observations:\n${rev.visualCaptions.map((c) => `- ${c}`).join('\n')}`);
    fieldsUsed.push('visualCaptions');
  }

  const documentText = lines.join('\n\n').trim();
  const contentHash = createHash('sha256').update(documentText, 'utf8').digest('hex');

  return {
    recipeVersion,
    contentHash,
    documentText,
    fieldsUsed,
  };
}
