/**
 * Staff / Moderator write model over migration 0005 RPCs.
 *
 * Runs client-side via getSupabaseBrowserClient (browser cookies).
 * Authority is enforced in the RPCs via public.caller_is_platform_moderator().
 */

import { getSupabaseBrowserClient } from '@/lib/auth/supabase-browser';

export type ModerationDecisionType =
  | 'approve'
  | 'request_changes'
  | 'reject'
  | 'dismiss'
  | 'takedown';

export interface ModeratorDecisionResult {
  readonly ok: true;
  readonly decisionId: string;
  readonly caseId: string;
  readonly decision: ModerationDecisionType;
  readonly listingId: string;
}

export interface ModeratorWriteError {
  readonly ok: false;
  readonly reasonCode: string;
  readonly message: string;
}

export type DecisionResult = ModeratorDecisionResult | ModeratorWriteError;

export async function decideModerationCase(
  caseId: string,
  decision: ModerationDecisionType,
  reasonCode: string,
  note?: string | null,
  idempotencyKey?: string | null,
): Promise<DecisionResult> {
  const client = getSupabaseBrowserClient();

  const { data, error } = await client.rpc('decide_moderation_case', {
    p_case_id: caseId,
    p_decision: decision,
    p_reason_code: reasonCode,
    p_note: note ?? null,
    p_idempotency_key: idempotencyKey ?? null,
  });

  if (error) {
    return { ok: false, reasonCode: 'rpc_call_failed', message: error.message };
  }

  const envelope = data as {
    ok?: boolean;
    reason_code?: string;
    message?: string;
    decision_id?: string;
    case_id?: string;
    decision?: string;
    listing_id?: string;
  };

  if (!envelope || envelope.ok === false) {
    return {
      ok: false,
      reasonCode: envelope?.reason_code ?? 'unexpected_response',
      message: envelope?.message ?? 'Failed to record moderation decision.',
    };
  }

  return {
    ok: true,
    decisionId: String(envelope.decision_id),
    caseId: String(envelope.case_id),
    decision: envelope.decision as ModerationDecisionType,
    listingId: String(envelope.listing_id),
  };
}

export async function bootstrapFirstAdmin(): Promise<
  { ok: true; role: string; userId: string } | ModeratorWriteError
> {
  const client = getSupabaseBrowserClient();

  const { data, error } = await client.rpc('bootstrap_first_admin');
  if (error) {
    return { ok: false, reasonCode: 'rpc_call_failed', message: error.message };
  }

  const envelope = data as {
    ok?: boolean;
    reason_code?: string;
    message?: string;
    role?: string;
    user_id?: string;
  };

  if (!envelope || envelope.ok === false) {
    return {
      ok: false,
      reasonCode: envelope?.reason_code ?? 'unexpected_response',
      message: envelope?.message ?? 'Failed to bootstrap admin role.',
    };
  }

  return {
    ok: true,
    role: String(envelope.role),
    userId: String(envelope.user_id),
  };
}
