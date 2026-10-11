/**
 * Shared contract primitives for the LUXONN marketplace domain (Phase 0).
 *
 * Pure types only: no runtime code, no dependencies. Every domain entity in
 * this directory mirrors these primitives. The Python (pydantic v2) mirrors
 * in docs/architecture/contracts.md follow a mechanical naming-parity rule:
 * TS camelCase maps to Python snake_case and nothing else differs.
 */

/**
 * Field classification, from docs/architecture/security-data-boundaries.md.
 *
 * - 'public'              -> "Public published": readable only through a
 *                             current published revision.
 * - 'restricted'          -> "Restricted operational": server-side role
 *                             checks; never in public Qdrant projections or
 *                             general Simon context.
 * - 'personal'            -> "Personal/consent-bound": purpose-limited,
 *                             consent-aware access and retention.
 * - 'derived-ai-evidence' -> "Derived AI evidence": versioned, attributable,
 *                             never a canonical business fact.
 * - 'secret'              -> "Secret": environment/secret manager only; never
 *                             source, logs, chat context, or documentation.
 *
 * No inherited column maps to 'secret' (the discovery brief's attestation);
 * the member exists because the security doc defines five classes.
 *
 * Special case: fields of PageContext that a browser supplies are classified
 * 'restricted' (they are operational intent, never published data) but carry
 * a TSDoc "untrusted" note — the server revalidates every id and fact.
 */
export type FieldClass =
  | 'public'
  | 'restricted'
  | 'personal'
  | 'derived-ai-evidence'
  | 'secret';

/** Branded entity identifier types (one per entity). Opaque strings. */
export type PropertyId = string & { readonly __brand: 'PropertyId' };
export type ListingId = string & { readonly __brand: 'ListingId' };
export type RevisionId = string & { readonly __brand: 'RevisionId' };
export type MediaId = string & { readonly __brand: 'MediaId' };
export type MediaObservationId = string & {
  readonly __brand: 'MediaObservationId';
};
export type VisualDossierId = string & { readonly __brand: 'VisualDossierId' };
export type EmbeddingId = string & { readonly __brand: 'EmbeddingId' };
export type OrganizationId = string & { readonly __brand: 'OrganizationId' };
export type MembershipId = string & { readonly __brand: 'MembershipId' };
export type PlatformRoleId = string & { readonly __brand: 'PlatformRoleId' };
/** Supabase Auth user id (never an authority by itself — ADR-012). */
export type UserId = string & { readonly __brand: 'UserId' };
export type ModerationCaseId = string & { readonly __brand: 'ModerationCaseId' };
export type ModerationDecisionId = string & {
  readonly __brand: 'ModerationDecisionId';
};
export type PreCheckId = string & { readonly __brand: 'PreCheckId' };
export type ViewingRequestId = string & {
  readonly __brand: 'ViewingRequestId';
};
export type HandoffId = string & { readonly __brand: 'HandoffId' };
export type AuditId = string & { readonly __brand: 'AuditId' };
export type OutboxEventId = string & { readonly __brand: 'OutboxEventId' };
export type ContactId = string & { readonly __brand: 'ContactId' };
export type ConsentId = string & { readonly __brand: 'ConsentId' };

/** ISO-8601 UTC instant string, e.g. 2026-10-11T14:30:00Z. */
export type Timestamp = string;

/**
 * A storage path inside Supabase Storage. Originals live in private,
 * authorization-scoped paths; derivatives are the only buyer-servable
 * artifacts, and only through approved/published revision links.
 */
export type StoragePath = string & { readonly __brand: 'StoragePath' };

/**
 * Structured money (ADR-001): the amount is a decimal string — never a bare
 * number — and the currency is an explicit code, never hardcoded. KES is the
 * product default, not a schema constant.
 */
export interface Money {
  /** Decimal string, e.g. "18000000". Never a float. */
  readonly amount: string;
  /** ISO 4217 currency code, e.g. "KES". Never defaulted or hardcoded. */
  readonly currency: string;
}

export const MoneyFieldClass = {
  amount: 'public',
  currency: 'public',
} as const satisfies Record<keyof Money, FieldClass>;

/** Actor vocabulary from the security doc's audit baseline. */
export type ActorType = 'anonymous' | 'buyer' | 'owner' | 'moderator' | 'service';

/**
 * Contact details collected for a specific purpose (viewing request,
 * handoff, buyer report). Personal/consent-bound: purpose-limited access and
 * retention. Contact fields are never lookup keys (the inherited schema keyed
 * viewings by raw phone — abolished).
 */
export interface VerifiedContact {
  readonly contact_id: ContactId;
  /** Contact channel; the verification step must have completed on it. */
  readonly channel: 'email' | 'phone';
  /** The address/number itself. Personal data; never a lookup key. */
  readonly value: string;
  /** Null until the verification step (ADR-016) completes. */
  readonly verified_at: Timestamp | null;
  /** Free-text name as provided for the exchange. */
  readonly display_name: string | null;
}

export const VerifiedContactFieldClass = {
  contact_id: 'personal',
  channel: 'personal',
  value: 'personal',
  verified_at: 'personal',
  display_name: 'personal',
} as const satisfies Record<keyof VerifiedContact, FieldClass>;

/**
 * Consent record covering a stated processing purpose. Consent does not
 * transfer through import (the inherited `consent_at` columns record consent
 * for the prototype's processing context); fresh consent is required for
 * every new target purpose. `inherited` provenance is allowed only for
 * continuity of live personal records, with the origin noted.
 */
export interface ConsentRecord {
  readonly consent_id: ConsentId;
  /** Stated processing purpose, e.g. viewing-request routing. */
  readonly purpose: string;
  readonly consented_at: Timestamp;
  /** Where consent was captured: the native UI or an inherited record. */
  readonly provenance: 'native' | 'inherited';
}

export const ConsentRecordFieldClass = {
  consent_id: 'personal',
  purpose: 'personal',
  consented_at: 'personal',
  provenance: 'personal',
} as const satisfies Record<keyof ConsentRecord, FieldClass>;

/** Cross-cutting audit record (security doc audit baseline). */
export interface AuditRecord {
  readonly audit_id: AuditId;
  readonly occurred_at: Timestamp;
  readonly actor_type: ActorType;
  /** Nullable stable server identity for the actor. */
  readonly actor_id: UserId | null;
  /** Always present for listing-scoped resources (ADR-012). */
  readonly organization_id: OrganizationId | null;
  /** e.g. "listing.submit". */
  readonly action: string;
  /** e.g. "listing_revision". */
  readonly resource_type: string;
  readonly resource_id: string;
  /** Idempotency/correlation identifier for the command. */
  readonly request_id: string;
  readonly outcome: 'accepted' | 'rejected' | 'completed' | 'failed';
  /** Stable policy or validation code. */
  readonly reason_code: string;
}

export const AuditRecordFieldClass = {
  audit_id: 'restricted',
  occurred_at: 'restricted',
  actor_type: 'restricted',
  actor_id: 'restricted',
  organization_id: 'restricted',
  action: 'restricted',
  resource_type: 'restricted',
  resource_id: 'restricted',
  request_id: 'restricted',
  outcome: 'restricted',
  reason_code: 'restricted',
} as const satisfies Record<keyof AuditRecord, FieldClass>;

/**
 * Transactional outbox event (ADR-005, marketplace-target). Written in the
 * same transaction as the state change; consumed idempotently by indexing,
 * media, notification, and CRM workers. Payloads are typed per event and
 * carry buyer-safe content plus operational references only — never
 * restricted fields (ADR-014).
 */
export interface OutboxEvent {
  readonly event_id: OutboxEventId;
  readonly occurred_at: Timestamp;
  /** Owning org for routing; platform-level events use the internal org. */
  readonly organization_id: OrganizationId | null;
  /** e.g. "listing.published". */
  readonly event_type: string;
  /** Typed, buyer-safe payload plus operational references. */
  readonly payload: Record<string, unknown>;
  readonly delivery_state: 'pending' | 'delivered' | 'failed';
  readonly delivery_attempts: number;
}

export const OutboxEventFieldClass = {
  event_id: 'restricted',
  occurred_at: 'restricted',
  organization_id: 'restricted',
  event_type: 'restricted',
  payload: 'restricted',
  delivery_state: 'restricted',
  delivery_attempts: 'restricted',
} as const satisfies Record<keyof OutboxEvent, FieldClass>;
