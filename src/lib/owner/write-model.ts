/**
 * Owner-side write model over the migration-0003 domain-command RPCs.
 *
 * The authority model mirrors the read model (see read-model.ts): every
 * call runs AS the signed-in owner through the request-cookie client, and
 * the SECURITY DEFINER RPCs re-check org membership explicitly. The one
 * caller-side obligation this module enforces is shape discipline on
 * `content`: only the revision-content fields validate_revision_content
 * knows about, keys in snake_case exactly as the SQL validator reads them.
 * ADR-014's restricted fields (exact_address, latitude, longitude) are not
 * even representable on this type — the validator rejects them server-side
 * anyway, but the type makes the leak impossible to typecheck.
 *
 * All five lifecycle RPCs share the typed-jsonb contract: success is an
 * envelope carrying the new entity's ids, rejection is
 * {ok:false, reason_code, message}. This module flattens both shapes into
 * the single WriteResult union so pages never parse jsonb envelopes.
 */

import { createAuthServerClient } from '@/lib/auth/supabase-server';

/** The exact content shape validate_revision_content (0003) accepts.
 *  Optional numeric fields may be omitted entirely — the validator only
 *  checks a key when present. listing_kind, availability, and price are
 *  mandatory there. */
export interface RevisionContentInput {
  readonly listing_kind: 'sale' | 'rent' | 'shortlet';
  readonly title: string;
  readonly description: string;
  readonly property_type: string;
  readonly property_subtype?: string | null;
  readonly availability: 'available';
  /** ADR-001 decimal string — the validator regex-matches this shape. */
  readonly price_amount: string;
  readonly price_currency: string;
  readonly price_period: 'one_time' | 'per_month' | 'per_night';
  readonly bedrooms?: number | null;
  readonly bathrooms?: number | null;
  readonly square_meters?: number | null;
  readonly lot_size_sqm?: number | null;
  readonly year_built?: number | null;
  readonly floor_number?: number | null;
  readonly total_floors?: number | null;
  readonly plot_dimensions?: string | null;
  readonly land_size_raw?: string | null;
  readonly area: string;
  readonly city: string;
  readonly town?: string | null;
  readonly county?: string | null;
  readonly country: string;
  readonly amenities?: string[];
}

/** Flattened typed rejection (same union as the read model). */
export interface OwnerRpcError {
  readonly ok: false;
  readonly reasonCode: string;
  readonly message: string;
}

/** Success envelopes the five lifecycle RPCs return on accept. */
export interface DraftCreated {
  readonly ok: true;
  readonly kind: 'draft_created';
  readonly organizationId: string;
  readonly propertyId: string;
  readonly listingId: string;
  readonly revisionId: string;
}

export interface RevisionCreated {
  readonly ok: true;
  readonly kind: 'revision_created';
  readonly listingId: string;
  readonly revisionId: string;
}

export interface RevisionUpdated {
  readonly ok: true;
  readonly kind: 'revision_updated';
  readonly revisionId: string;
}

export interface RevisionSubmitted {
  readonly ok: true;
  readonly kind: 'revision_submitted';
  readonly revisionId: string;
  /** Case reference from the moderation case the submit opened. */
  readonly caseReference: string | null;
}

export interface ListingWithdrawn {
  readonly ok: true;
  readonly kind: 'listing_withdrawn';
  readonly listingId: string;
}

export type WriteResult =
  | DraftCreated
  | RevisionCreated
  | RevisionUpdated
  | RevisionSubmitted
  | ListingWithdrawn
  | OwnerRpcError;

// ---------------------------------------------------------------
// Envelope plumbing
// ---------------------------------------------------------------

/**
 * Raw 0003 success envelopes. The exact key sets (from the migration, all
 * jsonb_build_object calls): create_listing_draft → organization_id,
 * property_id, listing_id, revision_id; create_revision_draft → listing_id,
 * revision_id; update_draft_revision → revision_id; submit_revision_for_review
 * → revision_id, case_reference; withdraw_listing → listing_id. Each carries
 * ok:true. Some additionally return message (idempotent replays).
 */
async function callWriteRpc(
  rpcName:
    | 'create_solo_organization'
    | 'create_listing_draft'
    | 'create_revision_draft'
    | 'update_draft_revision'
    | 'submit_revision_for_review'
    | 'withdraw_listing',
  params: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | OwnerRpcError> {
  const client = await createAuthServerClient();

  const { data, error } = await client.rpc(rpcName, params);
  if (error) {
    return { ok: false, reasonCode: 'rpc_call_failed', message: error.message };
  }

  if (
    data === null ||
    typeof data !== 'object' ||
    (data as Record<string, unknown>).ok !== true
  ) {
    // An envelope that reached us with ok:false — normalize it here so the
    // shape-specific handlers below only ever see successes.
    const envelope = data as { reason_code?: unknown; message?: unknown } | null;
    return {
      ok: false,
      reasonCode:
        envelope && typeof envelope.reason_code === 'string'
          ? envelope.reason_code
          : 'unexpected_response',
      message:
        envelope && typeof envelope.message === 'string'
          ? envelope.message
          : `${rpcName} returned a shape the write model does not understand.`,
    };
  }

  return { ok: true, data: data as Record<string, unknown> };
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}

function nullableStr(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ---------------------------------------------------------------
// Public API — one function per domain command
// ---------------------------------------------------------------

/**
 * Onboarding gate for a signed-in owner with no organization yet. Creates
 * the solo org + the caller's owner membership in one transaction. The
 * caller resolved "no orgs" through fetchOwnerOrganizations() first; this
 * function takes no org id because it CREATES one.
 */
export async function createSoloOrganization(
  displayName: string,
  publicBio: string | null,
): Promise<OwnerRpcError | { ok: true; organizationId: string }> {
  const result = await callWriteRpc('create_solo_organization', {
    p_display_name: displayName,
    p_public_bio: publicBio,
  });
  if (!result.ok) return result;

  const orgId = str(result.data, 'organization_id');
  if (orgId === '') {
    return {
      ok: false,
      reasonCode: 'unexpected_response',
      message: 'create_solo_organization returned no organization_id.',
    };
  }
  return { ok: true, organizationId: orgId };
}

/** Create a brand-new listing with its first draft revision. */
export async function createListingDraft(
  organizationId: string,
  content: RevisionContentInput,
  idempotencyKey?: string,
): Promise<WriteResult> {
  const result = await callWriteRpc('create_listing_draft', {
    p_organization_id: organizationId,
    p_content: content,
    ...(idempotencyKey !== undefined
      ? { p_idempotency_key: idempotencyKey }
      : {}),
  });
  if (!result.ok) return result;

  const listingId = str(result.data, 'listing_id');
  const revisionId = str(result.data, 'revision_id');
  if (listingId === '' || revisionId === '') {
    return {
      ok: false,
      reasonCode: 'unexpected_response',
      message: 'create_listing_draft returned an incomplete envelope.',
    };
  }
  return {
    ok: true,
    kind: 'draft_created',
    organizationId: str(result.data, 'organization_id'),
    propertyId: str(result.data, 'property_id'),
    listingId,
    revisionId,
  };
}

/** Add a new draft revision on top of a listing's published revision. */
export async function createRevisionDraft(
  listingId: string,
  content: RevisionContentInput,
  idempotencyKey?: string,
): Promise<WriteResult> {
  const result = await callWriteRpc('create_revision_draft', {
    p_listing_id: listingId,
    p_content: content,
    ...(idempotencyKey !== undefined
      ? { p_idempotency_key: idempotencyKey }
      : {}),
  });
  if (!result.ok) return result;

  const revisionId = str(result.data, 'revision_id');
  if (revisionId === '') {
    return {
      ok: false,
      reasonCode: 'unexpected_response',
      message: 'create_revision_draft returned no revision_id.',
    };
  }
  return { ok: true, kind: 'revision_created', listingId, revisionId };
}

/** Edit an existing draft revision's content in place. */
export async function updateDraftRevision(
  revisionId: string,
  content: RevisionContentInput,
  idempotencyKey?: string,
): Promise<WriteResult> {
  const result = await callWriteRpc('update_draft_revision', {
    p_revision_id: revisionId,
    p_content: content,
    ...(idempotencyKey !== undefined
      ? { p_idempotency_key: idempotencyKey }
      : {}),
  });
  if (!result.ok) return result;

  return { ok: true, kind: 'revision_updated', revisionId };
}

/** Move a draft into moderation. Opens the moderation case server-side. */
export async function submitRevisionForReview(
  revisionId: string,
  idempotencyKey?: string,
): Promise<WriteResult> {
  const result = await callWriteRpc('submit_revision_for_review', {
    p_revision_id: revisionId,
    ...(idempotencyKey !== undefined
      ? { p_idempotency_key: idempotencyKey }
      : {}),
  });
  if (!result.ok) return result;

  return {
    ok: true,
    kind: 'revision_submitted',
    revisionId,
    caseReference: nullableStr(result.data, 'case_reference'),
  };
}

/** PUBLISHED → WITHDRAWN. The only lifecycle transition the portal offers
 *  on published listings in Phase 2 (no relist — ADR-005 has no edge out of
 *  WITHDRAWN; re-entry is a fresh draft). */
export async function withdrawListing(
  listingId: string,
  idempotencyKey?: string,
): Promise<WriteResult> {
  const result = await callWriteRpc('withdraw_listing', {
    p_listing_id: listingId,
    ...(idempotencyKey !== undefined
      ? { p_idempotency_key: idempotencyKey }
      : {}),
  });
  if (!result.ok) return result;

  return { ok: true, kind: 'listing_withdrawn', listingId };
}
