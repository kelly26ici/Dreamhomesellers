/**
 * Buyer-side read model over the published marketplace surface.
 *
 * Every query here runs as the anonymous buyer through PostgREST (RLS
 * governs every row by construction — the site has no other DB path).
 * The authority chain is ADR-005: `listings` is the query root; content
 * resolves ONLY through the published_revision pointer; revisions are
 * never filtered by state client-side (the column is ungranted and the
 * `revision_public_read` policy already filters server-side).
 *
 * Structural facts this module depends on (probed live 2026-10-12, see
 * the FK-grant hardening commit):
 * - Embeds along `listings_published_revision_fk` require anon SELECT on
 *   the generated FK column `published_ref_revision_id` (granted).
 * - A revision->media embed is impossible for anon: listing_media's
 *   composite FK (revision_id, organization_id) would reference the
 *   restricted organization_id. Media is therefore fetched as a second
 *   query and stitched by revision_id — the contract surface stays
 *   exactly as FieldClass defines it.
 * - price_amount is selected with a ::text cast (ADR-001: money is a
 *   decimal string; PostgREST would otherwise serialize numeric as a
 *   JSON float).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ListingKind } from '@/lib/contracts/listing';
import type { RevisionId } from '@/lib/contracts/shared';
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/auth/supabase-key';

// Supabase calls the same public client key "anon" or "publishable" depending
// on when the project was created, and a deploy defines only ONE of those two
// env names. Reading a hardcoded name here is what returned HTTP 500 on every
// page while `next build` still passed — see lib/auth/supabase-key.ts.
const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_ANON_KEY = getSupabasePublicKey();

function anonClient(): SupabaseClient {
  // Memoized module-level: the anon client holds no session state
  // (persistSession off), so one instance serves every request safely.
  // A fresh client per call spawned multiple GoTrueClient instances in
  // the browser under the same storage key, which Supabase flags as
  // undefined behavior when used concurrently (e.g. a 4-way compare).
  //
  // This client is pure PostgREST — no code path ever touches supabase.auth
  // — so the auth machinery is also fully disabled: no session persistence,
  // no token auto-refresh, no eager init, and no URL callback consumption.
  // detectSessionInUrl would otherwise stay true (the supabase-js default),
  // and GoTrueClient auto-initializes at construction, letting this dead
  // client race the real @supabase/ssr browser client for a one-time OAuth
  // code on a callback URL (auth-js 2.117.3 runs the URL-detection branch
  // regardless of persistSession).
  anonClientInstance ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      skipAutoInitialize: true,
    },
  });
  return anonClientInstance;
}

let anonClientInstance: SupabaseClient | undefined;

/** Sort keys the grid exposes. URL-facing values, lowercase kebab. */
export type ListingSort =
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'bedrooms-desc';

const SORT_COLUMNS: Record<
  ListingSort,
  { column: string; ascending: boolean }
> = {
  newest: { column: 'published_at', ascending: false },
  'price-asc': { column: 'price_amount', ascending: true },
  'price-desc': { column: 'price_amount', ascending: false },
  'bedrooms-desc': { column: 'bedrooms', ascending: false },
};

/**
 * Grid filter state — exactly what the URL carries (ADR-006: the URL is
 * the search state). All optional; absent means unfiltered.
 */
export interface ListingFilters {
  /** Free text over title (PostgREST ilike, %wildcards%). */
  q?: string;
  /** Offer kind. Multi-select. */
  kinds?: ListingKind[];
  /** County exact match. */
  county?: string;
  /** Property type exact match. */
  type?: string;
  /** Minimum bedrooms (inclusive). */
  minBedrooms?: number;
  /** Price band, inclusive, in the listing currency. */
  minPrice?: number;
  maxPrice?: number;
  sort: ListingSort;
  page: number; // 1-based
}

export const PAGE_SIZE = 12;

/**
 * One grid card: the published offer with its verified content snapshot.
 * Every field here is buyer-visible ('public' FieldClass) by construction —
 * the query can only name granted columns.
 */
export interface PublishedListingCard {
  readonly listingId: string;
  readonly listingKind: ListingKind;
  readonly revisionId: RevisionId;
  readonly title: string;
  readonly description: string;
  /** ADR-001 money: decimal string + explicit currency. */
  readonly priceAmount: string;
  readonly priceCurrency: string;
  readonly pricePeriod: string;
  readonly propertyType: string;
  readonly propertySubtype: string | null;
  readonly availability: string;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly squareMeters: number | null;
  readonly lotSizeSqm: number | null;
  readonly area: string;
  readonly city: string;
  readonly county: string | null;
  readonly country: string;
  readonly amenities: string[];
  readonly furnished: boolean | null;
  readonly publishedAt: string | null;
}

/** Media rows as the buyer sees them (public FieldClass only). */
export interface PublicMediaRow {
  readonly mediaId: string;
  readonly revisionId: string;
  readonly position: number;
  readonly kind: string;
  readonly isFeatured: boolean;
  /** Storage paths of approved derivatives. Empty for the demo inventory —
   * Phase 3 has not run; the UI renders its media-pending placeholder. */
  readonly derivativePaths: string[];
}

export interface ListingGridResult {
  readonly cards: readonly PublishedListingCard[];
  readonly mediaByRevision: ReadonlyMap<RevisionId, readonly PublicMediaRow[]>;
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

const PUBLISHED_REVISION_FK =
  'listing_revisions!listings_published_revision_fk!inner' as const;

const REVISION_COLUMNS = [
  'revision_id',
  'title',
  'description',
  'property_type',
  'property_subtype',
  'availability',
  'price_amount:price_amount::text',
  'price_currency',
  'price_period',
  'bedrooms',
  'bathrooms',
  'square_meters',
  'lot_size_sqm',
  'area',
  'city',
  'county',
  'country',
  'amenities',
  'furnished',
  'published_at',
].join(',');

/**
 * Raw PostgREST row shape for a published listing joined to its revision.
 * The embed is verified live (many-to-one !inner returns an object, not an
 * array) but sits outside the type-parser's reach, so callers bridge via
 * unknown casts and this is the single place the runtime shape is declared.
 */
interface PublishedRow {
  listing_id: string;
  listing_kind: string;
  published_revision: {
    revision_id: string;
    title: string;
    description: string;
    property_type: string;
    property_subtype: string | null;
    availability: string;
    price_amount: string;
    price_currency: string;
    price_period: string;
    bedrooms: number | null;
    bathrooms: number | null;
    square_meters: number | null;
    lot_size_sqm: number | null;
    area: string;
    city: string;
    county: string | null;
    country: string;
    amenities: string[] | null;
    furnished: boolean | null;
    published_at: string | null;
  } | null;
}

/** Map one raw row to the domain card. The single raw->domain boundary. */
function toCard(row: PublishedRow): PublishedListingCard {
  const r = row.published_revision!;
  return {
    listingId: row.listing_id,
    listingKind: row.listing_kind as ListingKind,
    // PostgREST returns a plain string; this IS a revision id, so the
    // brand boundary is here (one cast at the raw->domain edge).
    revisionId: r.revision_id as RevisionId,
    title: r.title,
    description: r.description,
    priceAmount: r.price_amount,
    priceCurrency: r.price_currency,
    pricePeriod: r.price_period,
    propertyType: r.property_type,
    propertySubtype: r.property_subtype,
    availability: r.availability,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    squareMeters: r.square_meters,
    lotSizeSqm: r.lot_size_sqm,
    area: r.area,
    city: r.city,
    county: r.county,
    country: r.country,
    amenities: r.amenities ?? [],
    furnished: r.furnished,
    publishedAt: r.published_at,
  };
}

/**
 * Query the published grid. Filters that live on the revision are applied
 * through the !inner embed (a true join: parents without a published
 * revision cannot exist in the result, and embedded filters then filter
 * parent rows). Count uses named granted columns (count(*) is not granted
 * on column-restricted tables).
 */
export async function fetchPublishedGrid(
  filters: ListingFilters,
): Promise<ListingGridResult> {
  const supabase = anonClient();
  const sort = SORT_COLUMNS[filters.sort];

  let query = supabase
    .from('listings')
    .select(
      `listing_id, listing_kind, published_revision:${PUBLISHED_REVISION_FK}(${REVISION_COLUMNS})`,
      { count: 'exact' },
    )
    // The published pointer IS the authority; !inner drops any listing
    // whose pointer target RLS hides from this caller.
    .eq('lifecycle_state', 'published');

  const rev = 'published_revision';
  if (filters.q && filters.q.trim()) {
    query = query.ilike(`${rev}.title`, `%${filters.q.trim()}%`);
  }
  if (filters.kinds?.length) {
    query = query.in('listing_kind', filters.kinds);
  }
  if (filters.county) {
    query = query.eq(`${rev}.county`, filters.county);
  }
  if (filters.type) {
    query = query.eq(`${rev}.property_type`, filters.type);
  }
  if (filters.minBedrooms != null) {
    query = query.gte(`${rev}.bedrooms`, filters.minBedrooms);
  }
  if (filters.minPrice != null) {
    query = query.gte(`${rev}.price_amount`, filters.minPrice);
  }
  if (filters.maxPrice != null) {
    query = query.lte(`${rev}.price_amount`, filters.maxPrice);
  }

  query = query
    .order(sort.column, {
      ascending: sort.ascending,
      referencedTable: rev,
      nullsFirst: false,
    })
    .range((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE - 1);

  const { data, error, count } = await query.returns<
    Array<{
      listing_id: string;
      listing_kind: string;
      published_revision: {
        revision_id: string;
        title: string;
        description: string;
        property_type: string;
        property_subtype: string | null;
        availability: string;
        price_amount: string;
        price_currency: string;
        price_period: string;
        bedrooms: number | null;
        bathrooms: number | null;
        square_meters: number | null;
        lot_size_sqm: number | null;
        area: string;
        city: string;
        county: string | null;
        country: string;
        amenities: string[] | null;
        furnished: boolean | null;
        published_at: string | null;
      } | null;
    }>
  >();

  if (error) {
    throw new Error(`Published grid query failed: ${error.message}`);
  }

  const cards: PublishedListingCard[] = (data ?? [])
    .filter((row) => row.published_revision !== null)
    .map(toCard);

  // Media as a second query, stitched by revision_id (see module header).
  const mediaByRevision = await fetchMediaForRevisions(
    supabase,
    cards.map((c) => c.revisionId),
  );

  const total = count ?? cards.length;
  return {
    cards,
    mediaByRevision,
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * Buyer-safe media fetch. RLS (`media_public_read`) already guarantees only
 * processed+approved media attached to a live published pointer return;
 * this query just reads the granted public columns in display order.
 */
async function fetchMediaForRevisions(
  supabase: SupabaseClient,
  revisionIds: readonly string[],
): Promise<ReadonlyMap<RevisionId, readonly PublicMediaRow[]>> {
  const byRevision = new Map<RevisionId, PublicMediaRow[]>();
  if (revisionIds.length === 0) return byRevision;

  // revision_id values are server-generated UUIDs; batch with `in`.
  const { data, error } = await supabase
    .from('listing_media')
    .select('media_id, revision_id, position, kind, is_featured, derivative_paths')
    .in('revision_id', revisionIds as string[])
    .order('position', { ascending: true });

  if (error) {
    throw new Error(`Media query failed: ${error.message}`);
  }

  for (const row of data ?? []) {
    const list = byRevision.get(row.revision_id as RevisionId) ?? [];
    list.push({
      mediaId: row.media_id,
      revisionId: row.revision_id,
      position: row.position,
      kind: row.kind,
      isFeatured: row.is_featured,
      derivativePaths: (row.derivative_paths as string[] | null) ?? [],
    });
    byRevision.set(row.revision_id as RevisionId, list);
  }
  return byRevision;
}

/** Distinct counties among published listings, for the filter bar. */
export async function fetchPublishedCounties(): Promise<string[]> {
  const supabase = anonClient();
  const { data, error } = await supabase
    .from('listings')
    .select(
      `county:listing_revisions!listings_published_revision_fk!inner(county)`,
    )
    .eq('lifecycle_state', 'published');
  if (error) {
    throw new Error(`County facets query failed: ${error.message}`);
  }
  const counties = new Set<string>();
  for (const row of data ?? []) {
    // postgrest-js types embeds as arrays without generated Database types,
    // but this many-to-one !inner embed returns an object (verified live);
    // bridge through unknown rather than fight the generic.
    const c = (
      row as unknown as { county?: { county: string | null } | null }
    ).county;
    if (c?.county) counties.add(c.county);
  }
  return [...counties].sort();
}

/** Distinct property types among published listings, for the filter bar. */
export async function fetchPublishedTypes(): Promise<string[]> {
  const supabase = anonClient();
  const { data, error } = await supabase
    .from('listings')
    .select(
      `ptype:listing_revisions!listings_published_revision_fk!inner(property_type)`,
    )
    .eq('lifecycle_state', 'published');
  if (error) {
    throw new Error(`Type facets query failed: ${error.message}`);
  }
  const types = new Set<string>();
  for (const row of data ?? []) {
    // Same bridge as fetchPublishedCounties (runtime object, typed array).
    const t = (
      row as unknown as { ptype?: { property_type: string | null } | null }
    ).ptype;
    if (t?.property_type) types.add(t.property_type);
  }
  return [...types].sort();
}

/**
 * One published listing by id, for the /property/[listingId] detail page.
 * Returns null unless the listing is published AND its published revision
 * is buyer-visible (RLS enforces both); the page maps null to notFound().
 * ADR-014 holds by construction: the selected columns contain only
 * area-level location — no address field exists on the revision.
 */
export async function fetchPublishedListing(
  listingId: string,
): Promise<{
  readonly card: PublishedListingCard;
  readonly media: readonly PublicMediaRow[];
} | null> {
  // Guard the shape cheaply: anything that isn't a plausible UUID can't be
  // a listing id, and PostgREST would 400 on a malformed filter value.
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidLike.test(listingId)) return null;

  const supabase = anonClient();
  const { data, error } = await supabase
    .from('listings')
    .select(
      `listing_id, listing_kind, published_revision:${PUBLISHED_REVISION_FK}(${REVISION_COLUMNS})`,
    )
    .eq('listing_id', listingId)
    .eq('lifecycle_state', 'published')
    .limit(1);

  if (error) {
    throw new Error(`Listing detail query failed: ${error.message}`);
  }

  const row = ((data ?? [])[0] ?? null) as unknown as PublishedRow | null;
  if (!row || row.published_revision === null) return null;

  const card = toCard(row);

  const mediaByRevision = await fetchMediaForRevisions(supabase, [
    card.revisionId,
  ]);
  return { card, media: mediaByRevision.get(card.revisionId) ?? [] };
}

/**
 * The N most recently published listings for homepage merchandising
 * (FeaturedProperties / PropertyShowcase). Same published-only guarantee
 * as the grid: `listings` root, lifecycle_state='published', !inner embed,
 * RLS-enforced. Price/currency/period ride the revision embed so the UI
 * can format ADR-001 money strings.
 */
export async function fetchPublishedFeatured(
  limit = 3,
): Promise<readonly PublishedListingCard[]> {
  const supabase = anonClient();
  const { data, error } = await supabase
    .from('listings')
    .select(
      `listing_id, listing_kind, published_revision:${PUBLISHED_REVISION_FK}(${REVISION_COLUMNS})`,
    )
    .eq('lifecycle_state', 'published')
    .order('published_at', { ascending: false, referencedTable: 'published_revision', nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(`Featured listings query failed: ${error.message}`);
  }

  return ((data ?? []) as unknown as PublishedRow[])
    .filter((row) => row.published_revision !== null)
    .map(toCard);
}

/**
 * Fetch published listings by explicit ids, for the anonymous buyer's
 * saved/compare views. The caller passes listing IDs it stored client-side
 * (localStorage); only rows that are STILL published AND buyer-visible
 * through RLS come back, so an unpublished or moderated listing drops out
 * of the saved view automatically — the client store holds intent, never
 * facts. Order follows the caller's id order (saved-listings store is
 * most-recent-first); media is stitched alongside as in the grid.
 */
export async function fetchPublishedListingsByIds(
  listingIds: readonly string[],
): Promise<{
  readonly cards: readonly PublishedListingCard[];
  readonly mediaByRevision: ReadonlyMap<RevisionId, readonly PublicMediaRow[]>;
}> {
  if (listingIds.length === 0) {
    return { cards: [], mediaByRevision: new Map() };
  }

  const supabase = anonClient();
  const { data, error } = await supabase
    .from('listings')
    .select(
      `listing_id, listing_kind, published_revision:${PUBLISHED_REVISION_FK}(${REVISION_COLUMNS})`,
    )
    .in('listing_id', listingIds as string[])
    .eq('lifecycle_state', 'published');

  if (error) {
    throw new Error(`Saved-listings query failed: ${error.message}`);
  }

  const byId = new Map<string, PublishedListingCard>();
  for (const row of ((data ?? []) as unknown as PublishedRow[]).filter(
    (row) => row.published_revision !== null,
  )) {
    const card = toCard(row);
    byId.set(card.listingId, card);
  }
  // Preserve the caller's ordering; silently skip ids that no longer
  // resolve to a published, buyer-visible listing.
  const cards = listingIds
    .map((id) => byId.get(id))
    .filter((c): c is PublishedListingCard => c !== undefined);

  const mediaByRevision = await fetchMediaForRevisions(
    supabase,
    cards.map((c) => c.revisionId),
  );
  return { cards, mediaByRevision };
}

/**
 * Similar-residences candidates for the detail page's circular strip:
 * published listings sharing the subject's county AND property type,
 * excluding the subject itself. Small set (the strip's capacity), newest
 * first. Same published-only / RLS-governed construction as the grid; no
 * similarity score, just a deterministic county+type neighborhood — the
 * Qdrant semantic projection (Phase 4) will refine this later.
 */
export async function fetchPublishedSimilar(
  subject: {
    readonly listingId: string;
    readonly county: string | null;
    readonly propertyType: string;
  },
  limit = 8,
): Promise<readonly PublishedListingCard[]> {
  if (!subject.county) return [];

  const supabase = anonClient();
  const { data, error } = await supabase
    .from('listings')
    .select(
      `listing_id, listing_kind, published_revision:${PUBLISHED_REVISION_FK}(${REVISION_COLUMNS})`,
    )
    .eq('lifecycle_state', 'published')
    .eq('published_revision.county', subject.county)
    .eq('published_revision.property_type', subject.propertyType)
    .neq('listing_id', subject.listingId)
    .order('published_at', {
      ascending: false,
      referencedTable: 'published_revision',
      nullsFirst: false,
    })
    .limit(limit);

  if (error) {
    throw new Error(`Similar-listings query failed: ${error.message}`);
  }

  return ((data ?? []) as unknown as PublishedRow[])
    .filter((row) => row.published_revision !== null)
    .map(toCard);
}
