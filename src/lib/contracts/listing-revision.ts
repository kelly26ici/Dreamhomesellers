/**
 * ListingRevision — the immutable content snapshot (ADR-005).
 *
 * A submitted revision is reviewed as a stable artifact; approved/published
 * snapshots never change — every correction is a new draft revision. All
 * pipeline states (DRAFT -> SUBMITTED -> {CHANGES_REQUESTED | REJECTED |
 * APPROVED} -> PUBLISHING -> PUBLISHED) live on the revision. Historical
 * PUBLISHED revisions remain immutable history and are superseded only via
 * the Listing's published pointer, never edited.
 *
 * Public revisions never carry the ADR-014 restricted set (exact address,
 * latitude/longitude, contact data); approximate pins are derived at
 * render/index time from area fields only. AI-derived observations live in
 * separate derived-evidence shapes (listing-media.ts), never here.
 */

import type {
  FieldClass,
  ListingId,
  Money,
  OrganizationId,
  RevisionId,
  Timestamp,
  UserId,
} from './shared';
import type { CreationVia } from './property';

/**
 * Revision pipeline states, exactly ADR-005. CHANGES_REQUESTED and REJECTED
 * are reachable only from SUBMITTED and are terminal for that revision
 * artifact (the owner continues on a new draft). No state is renamed and no
 * state is added.
 */
export type RevisionState =
  | 'draft'
  | 'submitted'
  | 'changes_requested'
  | 'rejected'
  | 'approved'
  | 'publishing'
  | 'published';

/**
 * Terminal Listing states reachable only from PUBLISHED (ADR-005).
 * They live on the Listing, not on a revision.
 */
export type ListingTerminalState = 'withdrawn' | 'closed';

/**
 * The Listing's lifecycle_state: the active/published revision's pipeline
 * state, plus the two terminal states carried at Listing level.
 */
export type ListingLifecycleState = RevisionState | ListingTerminalState;

/**
 * Legal revision transitions, derived from ADR-005 exactly. Every state maps
 * to the (possibly empty) set of states reachable from it. Empty means
 * terminal for that revision artifact.
 */
export type RevisionTransitionMap = {
  readonly draft: readonly ['submitted'];
  readonly submitted: readonly ['approved', 'changes_requested', 'rejected'];
  /** Terminal for the artifact: the owner continues on a new draft. */
  readonly changes_requested: readonly [];
  /** Terminal for the artifact. */
  readonly rejected: readonly [];
  readonly approved: readonly ['publishing'];
  readonly publishing: readonly ['published'];
  /**
   * Historical PUBLISHED revisions are immutable. WITHDRAWN/CLOSED are
   * Listing-level transitions (see ListingTransitionMap), not revision-level
   * ones.
   */
  readonly published: readonly [];
};

/**
 * Legal Listing-level transitions. WITHDRAWN and CLOSED are reachable only
 * from PUBLISHED (owner withdrawal; moderator takedown forces
 * PUBLISHED->WITHDRAWN). ADR-005 draws no edge out of WITHDRAWN: re-entry is
 * recommended as a new draft -> SUBMITTED -> fresh human review -> PUBLISHED
 * (flagged for owner review in docs/architecture/contracts.md). CLOSED has no
 * exit; relisting is a new Listing on the same Property.
 */
export type ListingTransitionMap = {
  readonly published: readonly ['withdrawn', 'closed'];
  readonly withdrawn: readonly [];
  readonly closed: readonly [];
};

/**
 * Buyer-visible availability vocabulary, inherited from `public.property_status`
 * (provisional). 'available' is the only verified member (the prototype's
 * locked browse filter); the remaining members freeze in Phase 1 from the
 * `pg_enum` audit. Imported values pass through an audited mapping table;
 * unmappable values stage as unverified content rather than being coerced.
 */
export type Availability = 'available' | (string & {});

/**
 * Price period, inherited from `public.price_period` (provisional).
 * Prototype-known member 'one_time' plus an implied monthly value never
 * spelled out in the audited source; freezes in Phase 1 from the `pg_enum`
 * audit.
 */
export type PricePeriod = 'one_time' | (string & {});

/**
 * Property type, inherited from `public.property_type` (provisional).
 * Freezes in Phase 1 from the `pg_enum` audit; open to the audited members.
 */
export type PropertyType = (string & {});

export interface ListingRevision {
  /** Opaque identity; surfaces publicly only through the published pointer. */
  readonly revision_id: RevisionId;
  /** The commercial offer this revision belongs to. */
  readonly listing_id: ListingId;
  /** Denormalized ownership (ADR-012). */
  readonly organization_id: OrganizationId;
  /** Lineage: the published revision this draft corrects, when applicable.
   * Null for a first draft. Internal history, not buyer-visible. */
  readonly base_revision_id: RevisionId | null;
  /** Pipeline state of this revision artifact (ADR-005). Restricted: buyers
   * resolve content through the Listing's published pointer, never by
   * reading revision_state. */
  readonly revision_state: RevisionState;
  readonly title: string;
  readonly description: string;
  /** Provisional vocabulary (Phase 1 freeze via `pg_enum`). */
  readonly property_type: PropertyType;
  readonly property_subtype: string | null;
  /** Buyer-visible availability (inherited `status` concept); provisional
   * vocabulary frozen in Phase 1. */
  readonly availability: Availability;
  /** Structured price (ADR-001): amount as decimal string plus explicit
   * currency code. KES is the product default, never a schema constant. */
  readonly price: Money;
  /** Sale = 'one_time'; rent/shortlet carry the period. Provisional. */
  readonly price_period: PricePeriod;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly square_meters: number | null;
  readonly lot_size_sqm: number | null;
  readonly year_built: number | null;
  readonly floor_number: number | null;
  readonly total_floors: number | null;
  readonly plot_dimensions: string | null;
  readonly land_size_raw: string | null;
  /** Area-level location text (inherited `location`). Import audits per-row
   * precision under ADR-014: precise values move to Property.exact_address
   * (restricted) and never remain here. */
  readonly area: string;
  readonly city: string;
  readonly town: string | null;
  readonly county: string | null;
  readonly country: string;
  /** Owner-supplied, unverified until moderation. */
  readonly amenities: string[];
  readonly furnished: boolean | null;
  /** Draft author (owning-org member) or null for import-created rows. */
  readonly created_by: UserId | null;
  /** Provenance marker (ADR-015): imported revisions stage as DRAFT,
   * unverified, never grandfathered. */
  readonly created_via: CreationVia;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
  /** When this revision became the published pointer target. Buyer-facing
   * listing-age displays derive from this value, never inherited
   * timestamps. */
  readonly published_at: Timestamp | null;
}

export const ListingRevisionFieldClass = {
  revision_id: 'public',
  listing_id: 'public',
  organization_id: 'restricted',
  base_revision_id: 'restricted',
  revision_state: 'restricted',
  title: 'public',
  description: 'public',
  property_type: 'public',
  property_subtype: 'public',
  availability: 'public',
  price: 'public',
  price_period: 'public',
  bedrooms: 'public',
  bathrooms: 'public',
  square_meters: 'public',
  lot_size_sqm: 'public',
  year_built: 'public',
  floor_number: 'public',
  total_floors: 'public',
  plot_dimensions: 'public',
  land_size_raw: 'public',
  area: 'public',
  city: 'public',
  town: 'public',
  county: 'public',
  country: 'public',
  amenities: 'public',
  furnished: 'public',
  created_by: 'restricted',
  created_via: 'restricted',
  created_at: 'restricted',
  updated_at: 'restricted',
  published_at: 'public',
} as const satisfies Record<keyof ListingRevision, FieldClass>;
