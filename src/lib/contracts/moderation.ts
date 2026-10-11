/**
 * Moderation — case, decisions, pre-check evidence (ADR-013).
 *
 * Cases are opened by the submit command (kind='submission'), buyer-report
 * intake (kind='buyer_report'), or moderator intake (kind='staff_initiated'
 * — proactive staff review of a published listing; the marketplace-target
 * 'suspend' capability, so takedown is never reachable only through a
 * buyer report). Moderators are platform staff, never owner-org members.
 * Every decision writes an AuditRecord and emits the matching transition
 * outbox event. Pre-checks are deterministic validators on revision
 * content; they never approve or publish autonomously. Owners see outcomes
 * (approve / request_changes / reject + change note), never other orgs'
 * cases; buyers never see cases.
 */

import type {
  ConsentRecord,
  FieldClass,
  ListingId,
  ModerationCaseId,
  ModerationDecisionId,
  OrganizationId,
  PreCheckId,
  RevisionId,
  Timestamp,
  UserId,
  VerifiedContact,
} from './shared';

export type ModerationCaseKind =
  | 'submission'
  | 'buyer_report'
  | 'staff_initiated';
export type ModerationCaseState = 'open' | 'resolved';

export interface ModerationCase {
  readonly case_id: ModerationCaseId;
  /** Submission review, trust-and-safety intake, or proactive staff
   * review of a published listing. */
  readonly case_kind: ModerationCaseKind;
  /** Submitted revision under review, or the published revision
   * reported/reviewed. */
  readonly revision_id: RevisionId | null;
  readonly listing_id: ListingId;
  /** Owning org of the listed revision (ADR-012). */
  readonly organization_id: OrganizationId;
  readonly case_state: ModerationCaseState;
  /** buyer_report only; vocabulary freezes in Phase 1 (legacy column is
   * unmeasured, 0 rows). */
  readonly report_category: string | null;
  /** T&S evidence; may hold personal text — personal-data handling in
   * practice. */
  readonly report_note: string | null;
  /** buyer_report only; null on submission and staff_initiated cases.
   * Consent-coupled: when non-null, `reporter_consent` must be non-null —
   * consent covering collection and any T&S follow-up is captured at
   * intake (the inherited property_reports.consent_at was required). */
  readonly reporter_contact: VerifiedContact | null;
  /** buyer_report only. Required whenever `reporter_contact` is present;
   * null only when no contact was collected. While null, the contact is
   * inert: no moderator reply, clarification request, or contact attempt
   * may use it. */
  readonly reporter_consent: ConsentRecord | null;
  readonly reference: string | null;
  readonly idempotency_key: string | null;
  readonly opened_at: Timestamp;
  readonly resolved_at: Timestamp | null;
  readonly created_at: Timestamp;
}

export const ModerationCaseFieldClass = {
  case_id: 'restricted',
  case_kind: 'restricted',
  revision_id: 'restricted',
  listing_id: 'restricted',
  organization_id: 'restricted',
  case_state: 'restricted',
  report_category: 'restricted',
  report_note: 'restricted',
  reporter_contact: 'personal',
  reporter_consent: 'personal',
  reference: 'restricted',
  idempotency_key: 'restricted',
  opened_at: 'restricted',
  resolved_at: 'restricted',
  created_at: 'restricted',
} as const satisfies Record<keyof ModerationCase, FieldClass>;

/**
 * Human decision record. `approve` drives SUBMITTED->APPROVED;
 * `request_changes` drives SUBMITTED->CHANGES_REQUESTED; `reject` drives
 * SUBMITTED->REJECTED; `dismiss` closes a buyer_report or staff_initiated
 * case without action; `takedown` forces PUBLISHED->WITHDRAWN on the
 * Listing (on a buyer_report or staff_initiated case — a submission case
 * targets a revision that has never published).
 */
export type ModerationDecisionKind =
  | 'approve'
  | 'request_changes'
  | 'reject'
  | 'dismiss'
  | 'takedown';

export interface ModerationDecision {
  readonly decision_id: ModerationDecisionId;
  readonly case_id: ModerationCaseId;
  readonly revision_id: RevisionId | null;
  readonly organization_id: OrganizationId;
  /** Drives the ADR-005 revision transition. */
  readonly decision: ModerationDecisionKind;
  /** Platform moderator auth user — fixes the inherited reviewer
   * referential gap (`property_moderation_events.reviewer_id` has no FK). */
  readonly decided_by: UserId;
  readonly decided_at: Timestamp;
  /** Stable policy code (audit baseline). */
  readonly reason_code: string;
  /** Internal evidence; doubles as the change note when request_changes. */
  readonly note: string | null;
}

export const ModerationDecisionFieldClass = {
  decision_id: 'restricted',
  case_id: 'restricted',
  revision_id: 'restricted',
  organization_id: 'restricted',
  decision: 'restricted',
  decided_by: 'restricted',
  decided_at: 'restricted',
  reason_code: 'restricted',
  note: 'restricted',
} as const satisfies Record<keyof ModerationDecision, FieldClass>;

export type PreCheckOutcome = 'pass' | 'fail' | 'warn';

/**
 * Deterministic pre-check evidence (ADR-013): validators run on revision
 * content before human review to reduce load. They never approve or publish
 * autonomously — publication remains human-approved at launch.
 */
export interface PreCheckResult {
  readonly check_id: PreCheckId;
  readonly case_id: ModerationCaseId;
  readonly revision_id: RevisionId;
  readonly organization_id: OrganizationId;
  /** Validator id, e.g. "required-fields". */
  readonly check_code: string;
  readonly outcome: PreCheckOutcome;
  readonly detail_code: string | null;
  /** Version of the deterministic checker that ran. */
  readonly checker_version: string;
  readonly ran_at: Timestamp;
}

export const PreCheckResultFieldClass = {
  check_id: 'restricted',
  case_id: 'restricted',
  revision_id: 'restricted',
  organization_id: 'restricted',
  check_code: 'restricted',
  outcome: 'restricted',
  detail_code: 'restricted',
  checker_version: 'restricted',
  ran_at: 'restricted',
} as const satisfies Record<keyof PreCheckResult, FieldClass>;
