import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Internal outbox consumer endpoint.
 * Intended to be triggered by a cron job (pg_cron, Supabase Cron, or external scheduler).
 * Claims pending outbox events atomically (SKIP LOCKED), dispatches them by event_type,
 * and marks them delivered or failed with retry (max 3 attempts).
 *
 * Authorization: requires OUTBOX_CONSUMER_SECRET header match.
 */

export async function POST(req: NextRequest) {
  const secret = process.env.OUTBOX_CONSUMER_SECRET;
  if (!secret || req.headers.get('x-outbox-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: 'Service role key not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 1. Claim a batch of pending events
  const { data: events, error: claimError } = await supabase.rpc('claim_outbox_events', {
    p_batch_size: 10,
  });

  if (claimError) {
    console.error('Outbox claim error:', claimError);
    return NextResponse.json({ error: 'Failed to claim events' }, { status: 500 });
  }

  if (!events || events.length === 0) {
    return NextResponse.json({ processed: 0, message: 'No pending events' });
  }

  // 2. Dispatch each event
  const results: Array<{ eventId: string; eventType: string; outcome: 'delivered' | 'failed' }> = [];

  for (const event of events) {
    try {
      await dispatchEvent(event);

      await supabase.rpc('mark_outbox_event_delivered', { p_event_id: event.event_id });
      results.push({ eventId: event.event_id, eventType: event.event_type, outcome: 'delivered' });
    } catch (err) {
      console.error(`Outbox dispatch failed for ${event.event_id} (${event.event_type}):`, err);

      await supabase.rpc('mark_outbox_event_failed', { p_event_id: event.event_id });
      results.push({ eventId: event.event_id, eventType: event.event_type, outcome: 'failed' });
    }
  }

  return NextResponse.json({
    processed: results.length,
    delivered: results.filter((r) => r.outcome === 'delivered').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    results,
  });
}

/**
 * Event dispatcher. Routes each event_type to a handler.
 * Phase 6 handlers start as structured log stubs; real integrations
 * (email/SMS via Resend/Twilio, CRM webhook, calendar sync) plug in here.
 */
async function dispatchEvent(event: {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  organization_id: string | null;
  payload: Record<string, unknown>;
  correlation_id: string;
}) {
  switch (event.event_type) {
    case 'viewing_request.created':
      // Phase 6: send notification to org owner (email/SMS)
      console.log(
        `[outbox] viewing_request.created → org=${event.organization_id} ref=${event.payload.reference} listing=${event.payload.listing_id}`
      );
      break;

    case 'handoff.created':
      // Phase 6: route to CRM or notification queue
      console.log(
        `[outbox] handoff.created → org=${event.organization_id} ref=${event.payload.reference} kind=${event.payload.handoff_kind}`
      );
      break;

    case 'listing_revision.submitted':
      // Phase 6: notify moderators queue
      console.log(
        `[outbox] listing_revision.submitted → org=${event.organization_id} listing=${event.payload.listing_id}`
      );
      break;

    case 'moderation.case_opened':
      // Phase 6: notify moderator dashboard / push
      console.log(
        `[outbox] moderation.case_opened → org=${event.organization_id} case=${event.aggregate_id}`
      );
      break;

    case 'listing.draft_created':
      console.log(
        `[outbox] listing.draft_created → org=${event.organization_id} listing=${event.aggregate_id}`
      );
      break;

    case 'organization.created':
      console.log(
        `[outbox] organization.created → org=${event.aggregate_id}`
      );
      break;

    case 'media.uploaded':
      // Phase 6: trigger derivative generation worker
      console.log(
        `[outbox] media.uploaded → org=${event.organization_id} media=${event.payload.media_id}`
      );
      break;

    default:
      console.warn(`[outbox] Unhandled event type: ${event.event_type}`);
  }
}
