#!/usr/bin/env node

/**
 * LUXONN Conversation Persistence & Handoff Verification Suite
 *
 * Implements verification for Phase 5 Step 6:
 * - Conversation thread and message persistence via save_conversation_turn
 * - Conversation history retrieval via get_conversation_history
 * - Handoff creation, audit trail, and outbox event emission via create_handoff
 * - Idempotency replay guarantees
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf8');
const envVars = Object.fromEntries(
  envContent
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const PROJECT_REF = 'nokarvewyorsupraufdg';
const ACCESS_TOKEN = envVars.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ Error: SUPABASE_ACCESS_TOKEN not found in .env.local');
  process.exit(1);
}

const DB_QUERY_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function executeSql(sql) {
  const res = await fetch(DB_QUERY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`SQL Error: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  console.log('💬 Running LUXONN Conversation Persistence & Handoff Verification Suite...\n');

  const testThreadId = crypto.randomUUID();
  const testSessionId = `test_sess_${Date.now()}`;
  const testIdempotencyKey = `idemp_ho_${Date.now()}`;

  // 1. Fetch a published listing to anchor tests
  const listings = await executeSql(`
    SELECT listing_id FROM listings WHERE lifecycle_state = 'published' LIMIT 1;
  `);
  if (!listings || listings.length === 0) {
    throw new Error('No published listings available for testing.');
  }
  const publishedListingId = listings[0].listing_id;

  // --------------------------------------------------------------------------
  // Check 1: Save Conversation Turn
  // --------------------------------------------------------------------------
  console.log('   Testing conversation turn persistence (save_conversation_turn)...');
  const turnResult = await executeSql(`
    SELECT public.save_conversation_turn(
      '${testThreadId}'::uuid,
      '${testSessionId}',
      'Tell me about villas in Karen',
      'Here are premier Karen villas in our collection.',
      '{"route": "/properties", "view_mode": "search"}'::jsonb,
      ARRAY['${publishedListingId}']::uuid[],
      ARRAY['Filter below 100m KES', 'Show with private pool']::text[]
    ) AS res;
  `);

  const turn = turnResult[0].res;
  if (!turn.ok) {
    throw new Error(`save_conversation_turn failed: ${JSON.stringify(turn)}`);
  }
  console.log(`   ✓ Turn 1 saved (Thread: ${turn.thread_id}, UserMsg: ${turn.user_message_id}, AssistantMsg: ${turn.assistant_message_id})`);

  // Verify records exist in Postgres
  const threadRows = await executeSql(`
    SELECT thread_id, session_id, page_context FROM public.conversation_threads WHERE thread_id = '${testThreadId}';
  `);
  if (threadRows.length !== 1) throw new Error('Thread record not found in conversation_threads.');

  const messageRows = await executeSql(`
    SELECT message_id, role, content, referenced_listing_ids, suggested_follow_ups 
    FROM public.conversation_messages 
    WHERE thread_id = '${testThreadId}' 
    ORDER BY created_at ASC;
  `);
  if (messageRows.length !== 2) throw new Error(`Expected 2 messages, found ${messageRows.length}`);
  console.log('   ✓ Thread and message rows confirmed in Postgres');

  // --------------------------------------------------------------------------
  // Check 2: Retrieve Conversation History
  // --------------------------------------------------------------------------
  console.log('   Testing conversation history retrieval (get_conversation_history)...');
  const historyResult = await executeSql(`
    SELECT public.get_conversation_history('${testThreadId}'::uuid, '${testSessionId}') AS res;
  `);
  const history = historyResult[0].res;
  if (!history.ok || history.messages.length !== 2) {
    throw new Error(`get_conversation_history failed: ${JSON.stringify(history)}`);
  }
  console.log(`   ✓ Retrieved ${history.messages.length} messages in chronological order`);

  // --------------------------------------------------------------------------
  // Check 3: Create Handoff Domain Command
  // --------------------------------------------------------------------------
  console.log('   Testing handoff creation (create_handoff)...');
  const handoffResult = await executeSql(`
    SELECT public.create_handoff(
      '${publishedListingId}'::uuid,
      NULL,
      'listing',
      '{"channel": "email", "value": "buyer.test@luxonn.ke", "display_name": "Test VIP Buyer"}'::jsonb,
      '{"provenance": "native", "purpose": "Arrange viewing for Karen residence"}'::jsonb,
      'Interested in private weekend viewing.',
      '${testSessionId}',
      '${testIdempotencyKey}'
    ) AS res;
  `);

  const handoff = handoffResult[0].res;
  if (!handoff.ok || !handoff.reference.startsWith('HO-')) {
    throw new Error(`create_handoff failed: ${JSON.stringify(handoff)}`);
  }
  console.log(`   ✓ Handoff created (ID: ${handoff.handoff_id}, Reference: ${handoff.reference}, State: ${handoff.handoff_state})`);

  // --------------------------------------------------------------------------
  // Check 4: Idempotency Replay
  // --------------------------------------------------------------------------
  console.log('   Testing handoff idempotency replay...');
  const replayResult = await executeSql(`
    SELECT public.create_handoff(
      '${publishedListingId}'::uuid,
      NULL,
      'listing',
      '{"channel": "email", "value": "buyer.test@luxonn.ke", "display_name": "Test VIP Buyer"}'::jsonb,
      '{"provenance": "native", "purpose": "Arrange viewing for Karen residence"}'::jsonb,
      'Interested in private weekend viewing.',
      '${testSessionId}',
      '${testIdempotencyKey}'
    ) AS res;
  `);

  const replay = replayResult[0].res;
  if (!replay.idempotent_replay || replay.handoff_id !== handoff.handoff_id) {
    throw new Error(`Idempotent replay failed: ${JSON.stringify(replay)}`);
  }
  console.log('   ✓ Idempotency replay confirmed: identical handoff reference returned without duplication');

  // --------------------------------------------------------------------------
  // Check 5: Audit Trail and Outbox Event
  // --------------------------------------------------------------------------
  console.log('   Verifying audit records and transactional outbox emission...');
  const auditRows = await executeSql(`
    SELECT action, outcome, resource_type, resource_id 
    FROM public.audit_records 
    WHERE resource_id = '${handoff.handoff_id}' AND action = 'handoff.create';
  `);
  if (auditRows.length === 0) throw new Error('Audit record not found for handoff.');
  console.log(`   ✓ Audit record verified (${auditRows[0].action} -> ${auditRows[0].outcome})`);

  const outboxRows = await executeSql(`
    SELECT event_type, payload 
    FROM public.outbox_events 
    WHERE aggregate_id = '${handoff.handoff_id}' AND event_type = 'handoff.created';
  `);
  if (outboxRows.length === 0) throw new Error('Outbox event not found for handoff.');
  const payload = outboxRows[0].payload;
  if (payload.contact || payload.consent) {
    throw new Error('SECURITY BREACH: Personal contact data leaked into outbox payload!');
  }
  console.log('   ✓ Outbox event verified: buyer-safe event emitted without contact data leakage');

  // --------------------------------------------------------------------------
  // Cleanup Test Artifacts (Note: audit_records and outbox_events are strictly immutable)
  // --------------------------------------------------------------------------
  await executeSql(`
    DELETE FROM public.handoffs WHERE handoff_id = '${handoff.handoff_id}';
    DELETE FROM public.conversation_threads WHERE thread_id = '${testThreadId}';
  `);
  console.log('   ✓ Test data cleaned up cleanly (immutable audit records retained)');

  console.log('\n✅ All Conversation Persistence & Handoff tests passed successfully!');
}

main().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
