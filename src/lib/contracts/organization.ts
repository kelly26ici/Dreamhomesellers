/**
 * OwnerOrganization and satellites — organization-based tenancy (ADR-012).
 *
 * Authority always resolves through the membership row, never a bare user
 * id. Platform staff (moderators/admins) are a separate platform-role
 * assignment so moderation cannot inherit owner-org privileges.
 */

import type {
  ConsentId,
  ContactId,
  FieldClass,
  MembershipId,
  OrganizationId,
  PlatformRoleId,
  Timestamp,
  UserId,
} from './shared';

/** ADR-012 vocabulary. */
export type OrganizationKind = 'solo' | 'agency' | 'brokerage' | 'developer';

export interface OwnerOrganization {
  /** The authority unit; ids may appear on public "listed by" surfaces. */
  readonly organization_id: OrganizationId;
  /** Agency name, or person name for solo orgs. */
  readonly display_name: string;
  readonly kind: OrganizationKind;
  /** Internal service orgs (e.g. the auditable import-staging org), never
   * buyer-visible. */
  readonly is_internal: boolean;
  /** Org profile policy is a flagged Phase 0 decision (contracts.md). */
  readonly public_bio: string | null;
  /** Inherited external URLs must re-enter the storage pipeline before
   * display (zero buckets today; nothing inherited is buyer-visible). */
  readonly avatar_url: string | null;
  /** Trust badge. Forced false at import under ADR-015: no inherited badge
   * survives; it is re-earned through the target's verification workflow.
   * The inherited value is recorded as import provenance only. */
  readonly is_verified: boolean;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export const OwnerOrganizationFieldClass = {
  organization_id: 'public',
  display_name: 'public',
  kind: 'public',
  is_internal: 'restricted',
  public_bio: 'public',
  avatar_url: 'public',
  is_verified: 'public',
  created_at: 'restricted',
  updated_at: 'restricted',
} as const satisfies Record<keyof OwnerOrganization, FieldClass>;

/** Organization membership: the authority-resolution path (ADR-012). */
export type MemberRole = 'owner' | 'admin' | 'member';

export interface OrganizationMembership {
  readonly membership_id: MembershipId;
  readonly organization_id: OrganizationId;
  /** Supabase Auth user. Authority flows org -> membership -> user, never
   * the reverse. Import-synthesized orgs hold a userless pending membership
   * claimable only through a verified invite. */
  readonly user_id: UserId;
  readonly member_role: MemberRole;
  readonly created_at: Timestamp;
}

export const OrganizationMembershipFieldClass = {
  membership_id: 'restricted',
  organization_id: 'restricted',
  user_id: 'restricted',
  member_role: 'restricted',
  created_at: 'restricted',
} as const satisfies Record<keyof OrganizationMembership, FieldClass>;

/**
 * Platform staff role assignment (FLAGGED RECOMMENDATION, awaiting owner
 * review): moderator/administrator authority is modeled as a separate
 * platform-role table rather than org membership, so moderation cannot
 * inherit owner-org privileges. Whether staff instead form an internal
 * organization is a Phase 1 decision.
 */
export type PlatformStaffRole = 'moderator' | 'admin';

export interface PlatformRole {
  readonly platform_role_id: PlatformRoleId;
  readonly user_id: UserId;
  readonly role: PlatformStaffRole;
  readonly created_at: Timestamp;
}

export const PlatformRoleFieldClass = {
  platform_role_id: 'restricted',
  user_id: 'restricted',
  role: 'restricted',
  created_at: 'restricted',
} as const satisfies Record<keyof PlatformRole, FieldClass>;

/**
 * Organization contact candidate staged from inherited contact data
 * (migration-first resolution): the inherited `public_contact_*` fields and
 * `agents.email`/`phone` have no listing-content home, so they stage here as
 * personal/consent-bound candidates on the import-synthesized org —
 * restricted until fresh re-consent and a still-pending publication policy.
 * Never buyer-visible; never revision content.
 */
export interface OrgContactCandidate {
  readonly contact_id: ContactId;
  readonly organization_id: OrganizationId;
  readonly channel: 'email' | 'phone';
  readonly value: string;
  readonly display_name: string | null;
  /** Null: consent does not transfer through import; re-consent required. */
  readonly consent_id: ConsentId | null;
  /** Import provenance label, e.g. "properties.public_contact_phone". */
  readonly source_column: string;
  readonly staged_at: Timestamp;
}

export const OrgContactCandidateFieldClass = {
  contact_id: 'personal',
  organization_id: 'restricted',
  channel: 'personal',
  value: 'personal',
  display_name: 'personal',
  consent_id: 'personal',
  source_column: 'restricted',
  staged_at: 'restricted',
} as const satisfies Record<keyof OrgContactCandidate, FieldClass>;
