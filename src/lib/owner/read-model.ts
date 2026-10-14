/**
 * Owner-side read model over the migration-0004 RPCs.
 *
 * Unlike the buyer read model (which runs as anon through plain PostgREST),
 * every query here runs AS the signed-in owner: the session cookie is the
 * only thing that proves who is asking, so the Supabase client carries the
 * request cookies via @supabase/ssr. The three RPCs are SECURITY DEFINER and
 * re-check org membership explicitly (RLS is bypassed inside them) — the
 * client-side discipline is only ever to pass the org id the portal resolved
 * from `current_user_org_ids()`, never one taken from a URL or user input
 * that hasn't gone through that resolution.
 *
 * Design fact that forbids memoization here: `createAuthServerClient()`
 * closes over `cookies()` from next/headers, which is REQUEST-SCOPED. A
 * module-level memoized client would capture the first request's cookie jar
 * and leak owner sessions across requests. Every call constructs its client
 * fresh.
 *
 * Typed rejections: the RPCs return {ok:false, reason_code, message} instead
 * of throwing (migration 0004's contract). PostgREST returns those as 200s,
 * so callers branch on the union below rather than on HTTP errors.
 */

import { createAuthServerClient } from '@/lib/auth/supabase-server';
import type {
  Availability,
  ListingLifecycleState,
  PricePeriod,
  PropertyType,
  RevisionState,
} from '@/lib/contracts/listing-revision';
import type { CreationVia } from '@/lib/contracts/property';
import type { ListingKind } from '@/lib/contracts/listing';
import type { Money, Timestamp } from '@/lib/contracts/shared';

// ---------------------------------------------------------------
// Raw row shapes — exactly what migration 0004 projects (snake_case,
// 1:1 with the SQL). These exist ONLY inside this file; the domain
// types below are the export boundary.
// ---------------------------------------------------------------

/** One item of owner_listings_summary's `items` array. */
interface RawListingSummary {
  listing_id: string;
  listing_kind: string;
  lifecycle_state: string;
  created_via: string;
  created_at: string;
  updated_at: string;
  withdrawn_at: string | null;
  closed_at: string | null;
  published_revision_id: string | null;
  published_title: string | null;
  published_description: string | null;
  published_property_type: string | null;
  published_property_subtype: string | null;
  published_availability: string | null;
  published_price_amount: string | null;
  published_price_currency: string | null;
  published_price_period: string | null;
  published_bedrooms: number | null;
  published_bathrooms: number | null;
  published_square_meters: number | null;
  published_lot_size_sqm: number | null;
  published_year_built: number | null;
  published_furnished: boolean | null;
  published_amenities: string[] | null;
  published_area: string | null;
  published_city: string | null;
  published_town: string | null;
  published_county: string | null;
  published_country: string | null;
  published_published_at: string | null;
}

/** owner_listing_revision's full payload (minus the `ok` flag). */
interface RawRevisionDetail {
  listing_id: string;
  organization_id: string;
  revision_id: string;
  base_revision_id: string | null;
  revision_state: string;
  listing_kind: string;
  lifecycle_state: string;
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
  year_built: number | null;
  floor_number: number | null;
  total_floors: number | null;
  plot_dimensions: string | null;
  land_size_raw: string | null;
  area: string;
  city: string;
  town: string | null;
  county: string | null;
  country: string;
  amenities: string[];
  furnished: boolean;
  created_by: string | null;
  created_via: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

// ---------------------------------------------------------------
// Domain types — camelCase, the single raw→domain boundary lives in
// the two map functions below.
// ---------------------------------------------------------------

/** Lifecycle filter for fetchOwnerListings; undefined = all states. */
export type LifecycleFilter = ListingLifecycleState | 'all';

/** One row of the portal's listing index. */
export interface OwnerListingSummary {
  readonly listingId: string;
  readonly listingKind: ListingKind;
  readonly lifecycleState: ListingLifecycleState;
  readonly createdVia: CreationVia;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly withdrawnAt: Timestamp | null;
  readonly closedAt: Timestamp | null;
  /** The published-authority pointer; null for draft listings. */
  readonly publishedRevisionId: string | null;
  /** Content snapshot from the row published_revision_id points at. */
  readonly published: {
    readonly title: string | null;
    readonly description: string | null;
    readonly propertyType: PropertyType | null;
    readonly propertySubtype: string | null;
    readonly availability: Availability | null;
    readonly price: Money | null;
    readonly pricePeriod: PricePeriod | null;
    readonly bedrooms: number | null;
    readonly bathrooms: number | null;
    readonly squareMeters: number | null;
    readonly lotSizeSqm: number | null;
    readonly yearBuilt: number | null;
    readonly furnished: boolean | null;
    readonly amenities: readonly string[] | null;
    readonly area: string | null;
    readonly city: string | null;
    readonly town: string | null;
    readonly county: string | null;
    readonly country: string | null;
    readonly publishedAt: Timestamp | null;
  };
}

/** Full revision detail backing the listing detail/edit surfaces. */
export interface OwnerRevisionDetail {
  readonly listingId: string;
  readonly organizationId: string;
  readonly revisionId: string;
  /** The published revision this draft corrects; null for a first draft. */
  readonly baseRevisionId: string | null;
  readonly revisionState: RevisionState;
  readonly listingKind: ListingKind;
  readonly lifecycleState: ListingLifecycleState;
  readonly title: string;
  readonly description: string;
  readonly propertyType: PropertyType;
  readonly propertySubtype: string | null;
  readonly availability: Availability;
  readonly price: Money;
  readonly pricePeriod: PricePeriod;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly squareMeters: number | null;
  readonly lotSizeSqm: number | null;
  readonly yearBuilt: number | null;
  readonly floorNumber: number | null;
  readonly totalFloors: number | null;
  readonly plotDimensions: string | null;
  readonly landSizeRaw: string | null;
  readonly area: string;
  readonly city: string;
  readonly town: string | null;
  readonly county: string | null;
  readonly country: string;
  readonly amenities: readonly string[];
  readonly furnished: boolean;
  readonly createdBy: string | null;
  readonly createdVia: CreationVia;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly publishedAt: Timestamp | null;
}

/** Typed RPC rejection, mapped 1:1 from migration 0004's {ok:false,...}. */
export interface OwnerRpcError {
  readonly ok: false;
  readonly reasonCode: string;
  readonly message: string;
}

// ---------------------------------------------------------------
// RPC call helpers
// ---------------------------------------------------------------

type OwnerRpcName =
  | 'owner_listings_summary'
  | 'owner_listing_revision';

/**
 * Call a jsonb-envelope owner RPC as the signed-in user and normalize its
 * reply. Returns {ok:true, data} or a normalized rejection; network /
 * envelope failures surface as synthetic rejections so callers only ever
 * handle the one union.
 */
async function callOwnerRpc(
  rpcName: OwnerRpcName,
  params: Record<string, unknown>,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; reasonCode: string; message: string }
> {
  const client = await createAuthServerClient();

  const { data, error } = await client.rpc(rpcName, params);
  if (error) {
    return { ok: false, reasonCode: 'rpc_call_failed', message: error.message };
  }

  if (
    data === null ||
    typeof data !== 'object' ||
    typeof (data as Record<string, unknown>).ok !== 'boolean'
  ) {
    return {
      ok: false,
      reasonCode: 'unexpected_response',
      message: `${rpcName} returned a shape the read model does not understand.`,
    };
  }

  const envelope = data as {
    ok: boolean;
    reason_code?: unknown;
    message?: unknown;
  };

  if (!envelope.ok) {
    return {
      ok: false,
      reasonCode:
        typeof envelope.reason_code === 'string' ? envelope.reason_code : 'unknown',
      message: typeof envelope.message === 'string' ? envelope.message : '',
    };
  }

  return { ok: true, data };
}

// ---------------------------------------------------------------
// Raw → domain mappers (the single boundary)
// ---------------------------------------------------------------

function mapSummaryItem(raw: RawListingSummary): OwnerListingSummary {
  return {
    listingId: raw.listing_id,
    listingKind: raw.listing_kind as ListingKind,
    lifecycleState: raw.lifecycle_state as ListingLifecycleState,
    createdVia: raw.created_via as CreationVia,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    withdrawnAt: raw.withdrawn_at,
    closedAt: raw.closed_at,
    publishedRevisionId: raw.published_revision_id,
    published: {
      title: raw.published_title,
      description: raw.published_description,
      propertyType: raw.published_property_type as PropertyType | null,
      propertySubtype: raw.published_property_subtype,
      availability: raw.published_availability as Availability | null,
      price:
        raw.published_price_amount !== null &&
        raw.published_price_currency !== null
          ? {
              amount: raw.published_price_amount,
              currency: raw.published_price_currency,
            }
          : null,
      pricePeriod: raw.published_price_period as PricePeriod | null,
      bedrooms: raw.published_bedrooms,
      bathrooms: raw.published_bathrooms,
      squareMeters: raw.published_square_meters,
      lotSizeSqm: raw.published_lot_size_sqm,
      yearBuilt: raw.published_year_built,
      furnished: raw.published_furnished,
      amenities: raw.published_amenities,
      area: raw.published_area,
      city: raw.published_city,
      town: raw.published_town,
      county: raw.published_county,
      country: raw.published_country,
      publishedAt: raw.published_published_at,
    },
  };
}

function mapRevisionDetail(raw: RawRevisionDetail): OwnerRevisionDetail {
  return {
    listingId: raw.listing_id,
    organizationId: raw.organization_id,
    revisionId: raw.revision_id,
    baseRevisionId: raw.base_revision_id,
    revisionState: raw.revision_state as RevisionState,
    listingKind: raw.listing_kind as ListingKind,
    lifecycleState: raw.lifecycle_state as ListingLifecycleState,
    title: raw.title,
    description: raw.description,
    propertyType: raw.property_type as PropertyType,
    propertySubtype: raw.property_subtype,
    availability: raw.availability as Availability,
    price: {
      amount: raw.price_amount,
      currency: raw.price_currency,
    },
    pricePeriod: raw.price_period as PricePeriod,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    squareMeters: raw.square_meters,
    lotSizeSqm: raw.lot_size_sqm,
    yearBuilt: raw.year_built,
    floorNumber: raw.floor_number,
    totalFloors: raw.total_floors,
    plotDimensions: raw.plot_dimensions,
    landSizeRaw: raw.land_size_raw,
    area: raw.area,
    city: raw.city,
    town: raw.town,
    county: raw.county,
    country: raw.country,
    amenities: raw.amenities ?? [],
    furnished: raw.furnished,
    createdBy: raw.created_by,
    createdVia: raw.created_via as CreationVia,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    publishedAt: raw.published_at,
  };
}

// ---------------------------------------------------------------
// Public API
// ---------------------------------------------------------------

/**
 * Org discovery: which organizations does the signed-in user belong to?
 * Backed by the SECURITY DEFINER helper `current_user_org_ids()` from
 * migration 0001 — the same helper RLS policies invoke, deliberately
 * executable by the client. The portal treats length 0 as "needs
 * onboarding" (create_solo_organization from migration 0003), 1 as
 * "this is your org", and >1 as "let the user pick".
 */
export async function fetchOwnerOrganizations(): Promise<
  readonly string[] | OwnerRpcError
> {
  const client = await createAuthServerClient();

  const { data, error } = await client.rpc('current_user_org_ids');
  if (error) {
    return {
      ok: false,
      reasonCode: 'rpc_call_failed',
      message: error.message,
    };
  }

  // A setof uuid serializes through PostgREST as an array of strings.
  if (Array.isArray(data) && data.every((v) => typeof v === 'string')) {
    return data as readonly string[];
  }

  return {
    ok: false,
    reasonCode: 'unexpected_response',
    message: 'current_user_org_ids returned an unexpected shape.',
  };
}

/**
 * The portal's listing index: every listing the caller's org owns, with the
 * content snapshot of the revision that published_revision_id points at.
 * `lifecycleFilter` narrows the grid; undefined = all states (the RPC's
 * NULL default).
 */
export async function fetchOwnerListings(
  organizationId: string,
  lifecycleFilter?: LifecycleFilter,
): Promise<OwnerRpcError | { ok: true; items: readonly OwnerListingSummary[] }> {
  const filter =
    lifecycleFilter === undefined || lifecycleFilter === 'all'
      ? null
      : lifecycleFilter;

  const result = await callOwnerRpc('owner_listings_summary', {
    p_organization_id: organizationId,
    p_lifecycle_filter: filter,
  });
  if (!result.ok) {
    return { ok: false, reasonCode: result.reasonCode, message: result.message };
  }

  const raw = result.data as { items?: unknown };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
    return {
      ok: false,
      reasonCode: 'unexpected_response',
      message: 'owner_listings_summary returned an unexpected shape.',
    };
  }

  return {
    ok: true,
    items: (raw.items as RawListingSummary[]).map(mapSummaryItem),
  };
}

/**
 * Full revision content for the listing detail / edit surfaces. The RPC
 * re-checks org membership server-side, so passing a revision id straight
 * from a URL is safe — the worst case is a typed not_authorized rejection
 * (which the database also writes to the audit log).
 */
export async function fetchOwnerRevision(
  revisionId: string,
): Promise<OwnerRpcError | { ok: true; detail: OwnerRevisionDetail }> {
  const result = await callOwnerRpc('owner_listing_revision', {
    p_revision_id: revisionId,
  });
  if (!result.ok) {
    return { ok: false, reasonCode: result.reasonCode, message: result.message };
  }

  return { ok: true, detail: mapRevisionDetail(result.data as RawRevisionDetail) };
}
