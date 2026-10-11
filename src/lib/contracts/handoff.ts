/**
 * Handoff — buyer-to-owner lead (marketplace-target).
 *
 * Created from the UI or Simon's `create_handoff` tool. A consequential
 * action (contacts a person), so it requires: explicit user confirmation,
 * server-validated input, verified contact, rate limits, an audit record,
 * and idempotency (security doc). Routed via outbox consumers
 * (notifications/CRM); the owner org acknowledges or closes. Never carries
 * restricted property data (ADR-014).
 */

import type {
  ConsentRecord,
  FieldClass,
  HandoffId,
  ListingId,
  OrganizationId,
  Timestamp,
  UserId,
  VerifiedContact,
  ViewingRequestId,
} from './shared';
import type { RequestingActorType } from './viewing-request';

/** Verified legacy vocabulary (prototype inquiry types). */
export type HandoffKind = 'general' | 'viewing' | 'listing';

export type HandoffState =
  | 'pending_contact_verification'
  | 'routed'
  | 'acknowledged'
  | 'closed'
  | 'expired';

export interface Handoff {
  readonly handoff_id: HandoffId;
  /** Null for general concierge handoffs. */
  readonly listing_id: ListingId | null;
  /** Continuity after a viewing request. */
  readonly viewing_request_id: ViewingRequestId | null;
  /** Routed owner org; null = platform concierge. */
  readonly organization_id: OrganizationId | null;
  readonly actor_type: RequestingActorType;
  readonly requester_user_id: UserId | null;
  readonly requester_session_id: string | null;
  readonly handoff_kind: HandoffKind;
  readonly message: string | null;
  /** Verified before routing to owners. */
  readonly contact: VerifiedContact;
  readonly consent: ConsentRecord;
  readonly handoff_state: HandoffState;
  /** Required: buyer follow-up needs a human-facing code. */
  readonly reference: string;
  readonly idempotency_key: string | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export const HandoffFieldClass = {
  handoff_id: 'restricted',
  listing_id: 'restricted',
  viewing_request_id: 'restricted',
  organization_id: 'restricted',
  actor_type: 'restricted',
  requester_user_id: 'restricted',
  requester_session_id: 'restricted',
  handoff_kind: 'restricted',
  message: 'personal',
  contact: 'personal',
  consent: 'personal',
  handoff_state: 'restricted',
  reference: 'restricted',
  idempotency_key: 'restricted',
  created_at: 'restricted',
  updated_at: 'restricted',
} as const satisfies Record<keyof Handoff, FieldClass>;
