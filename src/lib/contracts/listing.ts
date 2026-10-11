/**
 * Listing — the commercial offer for a property (marketplace-target).
 *
 * The Listing owns the buyer-facing lifecycle surface: before first
 * publication its `lifecycle_state` mirrors the working revision's pipeline
 * state; once published it stays 'published' through any correction cycle
 * (the correction draft's pipeline progress never surfaces here) until
 * withdrawal/closure or the next PUBLISHING->PUBLISHED atomic swap, and it
 * carries the two terminal states (WITHDRAWN, CLOSED) that ADR-005 places
 * after PUBLISHED. `published_revision_id` is the sole public authority: it
 * is set only at PUBLISHING->PUBLISHED as an atomic swap and retained
 * through WITHDRAWN/CLOSED — visibility then gates on `lifecycle_state`,
 * and Qdrant points are removed or made unreachable.
 */

import type {
  FieldClass,
  ListingId,
  OrganizationId,
  PropertyId,
  RevisionId,
  Timestamp,
} from './shared';
import type { CreationVia } from './property';
import type { ListingLifecycleState } from './listing-revision';

/**
 * Offer-kind vocabulary, inherited from `public.listing_type`
 * (provisional): the inherited enum's value list was never obtainable
 * through REST — sale/rent/shortlet are the prototype-known members
 * (discovery brief: "vocabulary known only from code"; pg_enum audit
 * backlog). Freezes in Phase 1 from the pg_enum audit; imported values
 * pass through the audited mapping table and unmappable values stage as
 * unverified content, never coerced.
 */
export type ListingKind = 'sale' | 'rent' | 'shortlet' | (string & {});

export interface Listing {
  /** Opaque identity; the buyer-addressable entity (URLs, compare, save). */
  readonly listing_id: ListingId;
  /** Internal link to the physical asset record. Restricted: the Property
   * carries ADR-014 data, so the linkage itself is operational. */
  readonly property_id: PropertyId;
  /** Denormalized ownership (ADR-012); authority resolves through
   * membership, never a bare user id. */
  readonly organization_id: OrganizationId;
  /** Offer identity (provisional vocabulary; prototype-known
   * sale/rent/shortlet). Public: a kind change is a new Listing, so it
   * never changes on an existing listing. */
  readonly listing_kind: ListingKind;
  /** Before first publication: mirrors the working revision's pipeline
   * state. Once published: stays 'published' through any correction cycle
   * — the correction draft's pipeline progress (draft/submitted/approved/
   * publishing) never surfaces here, so previously published content
   * stays live until the next PUBLISHING->PUBLISHED atomic swap — and
   * carries WITHDRAWN/CLOSED. Only PUBLISHED, WITHDRAWN, and CLOSED are
   * externally observable; buyers see content only through the published
   * pointer. */
  readonly lifecycle_state: ListingLifecycleState;
  /** Sole public authority: set only at PUBLISHING->PUBLISHED (atomic swap);
   * retained through WITHDRAWN/CLOSED while visibility gates on
   * lifecycle_state. Null before first publication. */
  readonly published_revision_id: RevisionId | null;
  /** Provenance marker (ADR-015): imported listings are staged unverified. */
  readonly created_via: CreationVia;
  /** For imported rows: the import-run timestamp (the flat inherited
   * `created_at` cannot attest to listing creation; it lands on
   * Property.created_at as first-seen provenance instead). */
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
  /** Provenance of the WITHDRAWN transition (owner action or moderator
   * takedown). Null unless withdrawn. */
  readonly withdrawn_at: Timestamp | null;
  /** Provenance of the CLOSED transition. Null unless closed. CLOSED is
   * terminal: relisting is a new Listing on the same Property. */
  readonly closed_at: Timestamp | null;
}

export const ListingFieldClass = {
  listing_id: 'public',
  property_id: 'restricted',
  organization_id: 'restricted',
  listing_kind: 'public',
  /** Public, but only PUBLISHED / WITHDRAWN / CLOSED are externally
   * observable — pipeline values (draft…publishing) never render on
   * buyer-visible surfaces. */
  lifecycle_state: 'public',
  published_revision_id: 'public',
  created_via: 'restricted',
  created_at: 'restricted',
  updated_at: 'restricted',
  withdrawn_at: 'restricted',
  closed_at: 'restricted',
} as const satisfies Record<keyof Listing, FieldClass>;
