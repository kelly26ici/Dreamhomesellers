/**
 * Property — the stable physical asset record (marketplace-target).
 *
 * The Property carries the ADR-014 restricted set (exact address, latitude,
 * longitude): restricted operational data that NEVER appears in public
 * revision shapes, buyer-visible read models, Qdrant projections, or Simon
 * page context. Public content (rooms, areas, amenities) lives on
 * ListingRevision, published through the listing pointer.
 */

import type { FieldClass, OrganizationId, PropertyId, Timestamp } from './shared';

/**
 * Import/verification posture per ADR-015: no inherited row is grandfathered
 * as published. Every imported record arrives unverified; buyers never see an
 * imported row until an owner confirms it and moderation approves.
 */
export type VerificationStatus = 'unverified' | 'verified';

/** How the record entered the system. */
export type CreationVia = 'owner' | 'import';

export interface Property {
  /** Opaque identity, carried for traceability. Buyer surfaces key on
   * ListingId/RevisionId, never PropertyId; Qdrant is rebuilt so no id
   * coupling survives. */
  readonly property_id: PropertyId;
  /** Denormalized ownership (ADR-012): the organization that owns the
   * asset's listing. Authority resolves through membership, never a bare
   * user id. */
  readonly organization_id: OrganizationId;
  /** ADR-014: exact address. Restricted; released only after an accepted
   * viewing request (or equivalent verified step). Never in revisions,
   * read models, Qdrant, or Simon context. */
  readonly exact_address: string | null;
  /** ADR-014: precise latitude. Restricted; public maps use approximate
   * pins derived from public area fields only. */
  readonly latitude: number | null;
  /** ADR-014: precise longitude. Restricted, same rule as latitude. */
  readonly longitude: number | null;
  /** ADR-015 staging state. Import initializes 'unverified' regardless of
   * any inherited `last_verified_at` value. */
  readonly verification_status: VerificationStatus;
  /** Ingestion provenance (inherited `properties.source`). */
  readonly source: string | null;
  /** Ingestion provenance (inherited `properties.external_id`); the
   * import dedupe key. */
  readonly external_id: string | null;
  /** Provenance marker distinguishing imported rows from owner-created
   * ones. */
  readonly created_via: CreationVia;
  /** For imported rows: first-seen ingestion time (the inherited flat
   * `created_at`), as unverified provenance only. Buyer-facing age
   * displays use ListingRevision.published_at, never this value. */
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export const PropertyFieldClass = {
  property_id: 'restricted',
  organization_id: 'restricted',
  exact_address: 'restricted',
  latitude: 'restricted',
  longitude: 'restricted',
  verification_status: 'restricted',
  source: 'restricted',
  external_id: 'restricted',
  created_via: 'restricted',
  created_at: 'restricted',
  updated_at: 'restricted',
} as const satisfies Record<keyof Property, FieldClass>;
