/**
 * ViewingRequest (ADR-016).
 *
 * Anonymous or authenticated buyers create requests under tight limits.
 * Contact verification (email or phone confirmation) must complete before
 * the request becomes owner-visible (`open`) — unverified contact cannot
 * reach owners. Acceptance discloses the exact address to that requester
 * (audited, ADR-014) and books the slot. Lookups use request_id or the
 * authenticated requester — never a raw phone scan (the inherited schema
 * keyed viewings by customer phone; that is abolished). The inherited 26
 * rows are legacy-only personal data under retention rules, not migrated as
 * actionable requests.
 */

import type {
  ConsentRecord,
  FieldClass,
  ListingId,
  OrganizationId,
  Timestamp,
  UserId,
  VerifiedContact,
  ViewingRequestId,
} from './shared';

export type RequestingActorType = 'anonymous' | 'buyer';

export type ViewingRequestState =
  | 'pending_contact_verification'
  | 'open'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'completed'
  | 'cancelled';

/**
 * Meeting-mode vocabulary (provisional — the inherited `mode` column is
 * free text, never measured). Freezes in Phase 1.
 */
export type ViewingMode = 'in_person' | 'virtual' | (string & {});

/** The requested slot. Personal data (viewing preference). */
export interface ViewingSlot {
  /** Explicit instant; no server-timezone dependency — closes the
   * prototype's `normalize_when` defect, which silently assumed the host
   * timezone was Africa/Nairobi. */
  readonly viewing_date: Timestamp;
  readonly duration_minutes: number;
  readonly alternate_viewing_date: Timestamp | null;
  /** Provisional vocabulary (Phase 1 freeze). Deliberately re-homed from
   * the brief's restricted-operational label for the inherited
   * `scheduled_viewings.mode` column ("meeting-mode label"): as part of
   * the requester's slot preference it is personal/consent-bound (the
   * security doc lists viewing preferences among personal examples); both
   * classes bar public exposure. */
  readonly mode: ViewingMode;
}

export const ViewingSlotFieldClass = {
  viewing_date: 'personal',
  duration_minutes: 'personal',
  alternate_viewing_date: 'personal',
  mode: 'personal',
} as const satisfies Record<keyof ViewingSlot, FieldClass>;

export interface ViewingRequest {
  /** Primary key — never keyed by phone (PII is not a lookup key). */
  readonly request_id: ViewingRequestId;
  /** The commercial offer; fixes the inherited missing FK
   * (`scheduled_viewings.property_id` had no declared FK). Unresolvable
   * orphans stay legacy-only. */
  readonly listing_id: ListingId;
  /** Owning org for routing (ADR-012). */
  readonly organization_id: OrganizationId;
  readonly actor_type: RequestingActorType;
  /** Auth user when authenticated. */
  readonly requester_user_id: UserId | null;
  /** Server-generated anonymous session id, not PII. */
  readonly requester_session_id: string | null;
  /** Email/phone require the verification step before owner visibility. */
  readonly contact: VerifiedContact;
  /** Covers contact collection and the stated purpose. */
  readonly consent: ConsentRecord;
  /** ADR-016 requirement. */
  readonly stated_purpose: string;
  readonly preferred_slot: ViewingSlot;
  readonly notes: string | null;
  /** Owner-invisible until verified; `accepted` replaces the inherited
   * hardcoded `confirmed`, which is abolished. Expiries are
   * worker-managed. */
  readonly request_state: ViewingRequestState;
  /** ADR-014 disclosure provenance: set when acceptance discloses the
   * exact address to this requester. */
  readonly address_disclosed_at: Timestamp | null;
  /** Human-facing code. */
  readonly reference: string;
  readonly idempotency_key: string | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export const ViewingRequestFieldClass = {
  request_id: 'restricted',
  listing_id: 'restricted',
  organization_id: 'restricted',
  actor_type: 'restricted',
  requester_user_id: 'restricted',
  requester_session_id: 'restricted',
  contact: 'personal',
  consent: 'personal',
  stated_purpose: 'personal',
  preferred_slot: 'personal',
  notes: 'personal',
  request_state: 'restricted',
  address_disclosed_at: 'restricted',
  reference: 'restricted',
  idempotency_key: 'restricted',
  created_at: 'restricted',
  updated_at: 'restricted',
} as const satisfies Record<keyof ViewingRequest, FieldClass>;
