/**
 * PageContext — typed transient intent (ADR-008).
 *
 * Created by the native client each relevant turn; read by Simon as intent
 * only. The server revalidates every id and fact against Postgres (security
 * doc trust rules); context is never persisted as authority and never
 * substitutes for retrieval. No restricted property field ever appears here
 * (ADR-014) — in particular, no property latitude/longitude and no exact
 * address. Browsing/search context is generous; chat turns remain
 * rate-limited (ADR-016).
 *
 * Classification note: browser-supplied fields are classed 'restricted'
 * (operational intent, never published data) but are UNTRUSTED until the
 * server revalidates them. The visitor's own approximate location is
 * 'personal' (consent-bound, revocable).
 */

import type {
  FieldClass,
  ListingId,
  RevisionId,
} from './shared';

export type PageViewMode =
  | 'search'
  | 'property_detail'
  | 'compare'
  | 'curated'
  | 'saved'
  | 'workspace'
  | 'other';

/** URL-backed search filters. Untrusted intent; the server revalidates. */
export interface SearchFilters {
  readonly listing_kind: string | null;
  readonly property_type: string | null;
  /** Decimal-string bounds, matching Money.amount semantics; denominated
   * in `price_currency` (or, when null, the server's explicit product-level
   * default) and compared against each revision's own Money.currency. */
  readonly min_price: string | null;
  readonly max_price: string | null;
  /** ISO 4217 currency the price bounds are denominated in;
   * server-validated. Null: the server applies an explicit product-level
   * default (KES at launch — a product default, not a schema constant).
   * Bounds never resolve against an implicit market default (ADR-001). */
  readonly price_currency: string | null;
  readonly min_bedrooms: number | null;
  readonly min_bathrooms: number | null;
  readonly city: string | null;
  readonly area: string | null;
  readonly amenities: readonly string[] | null;
  /** Server-defined ordering key; the inherited `created_at.desc` browse
   * order is not carried forward. */
  readonly sort: string | null;
  readonly cursor: string | null;
}

export const SearchFiltersFieldClass = {
  listing_kind: 'restricted',
  property_type: 'restricted',
  min_price: 'restricted',
  max_price: 'restricted',
  price_currency: 'restricted',
  min_bedrooms: 'restricted',
  min_bathrooms: 'restricted',
  city: 'restricted',
  area: 'restricted',
  amenities: 'restricted',
  sort: 'restricted',
  cursor: 'restricted',
} as const satisfies Record<keyof SearchFilters, FieldClass>;

/**
 * The visitor's own consented approximate location — personal data,
 * revocable, collected only after consent (security doc privacy rules).
 * NEVER property location: no listing's coordinates may appear here.
 */
export interface ApproximateLocation {
  readonly latitude: number;
  readonly longitude: number;
}

export const ApproximateLocationFieldClass = {
  latitude: 'personal',
  longitude: 'personal',
} as const satisfies Record<keyof ApproximateLocation, FieldClass>;

export interface PageContext {
  /** Semver of this contract. */
  readonly contract_version: string;
  /** Monotonic per session. */
  readonly sequence: number;
  /** App route. */
  readonly route: string;
  readonly view_mode: PageViewMode;
  readonly active_listing_id: ListingId | null;
  /** Published revision id; the server revalidates it against the
   * Listing's published pointer. */
  readonly active_revision_id: RevisionId | null;
  readonly result_position: number | null;
  readonly result_count: number | null;
  /** Bounded to the current page. */
  readonly visible_listing_ids: readonly ListingId[];
  readonly search_filters: SearchFilters | null;
  /** Bounded (<= 4, matching the prototype's compare cap). */
  readonly compare_selection: readonly ListingId[];
  readonly approximate_location: ApproximateLocation | null;
}

export const PageContextFieldClass = {
  contract_version: 'restricted',
  sequence: 'restricted',
  route: 'restricted',
  view_mode: 'restricted',
  active_listing_id: 'restricted',
  active_revision_id: 'restricted',
  result_position: 'restricted',
  result_count: 'restricted',
  visible_listing_ids: 'restricted',
  search_filters: 'restricted',
  compare_selection: 'restricted',
  approximate_location: 'personal',
} as const satisfies Record<keyof PageContext, FieldClass>;
