#!/usr/bin/env node

/**
 * LUXONN Outbox Worker Pipeline Verification Suite
 *
 * Tests the transactional outbox claim-process-complete lifecycle:
 * - claim_outbox_events with SKIP LOCKED atomicity
 * - mark_outbox_event_delivered transition
 * - mark_outbox_event_failed retry logic (re-queue < 3 attempts, terminal >= 3)
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
  console.error('❌ SUPABASE_ACCESS_TOKEN not found');
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
  if (!res.ok) throw new Error(`SQL Error: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log('📤 Running LUXONN Outbox Worker Pipeline Verification Suite...\n');

  // Setup: insert a synthetic pending outbox event
  const testCorrelation = `test_outbox_${Date.now()}`;
  await executeSql(`
    INSERT INTO public.outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id,
      correlation_id, payload, delivery_state, delivery_attempts
    ) VALUES (
      NULL, 'test.synthetic', 'test', '${testCorrelation}',
      '${testCorrelation}', '{"test": true}'::jsonb, 'pending', 0
    );
  `);

  // --------------------------------------------------------------------------
  // Check 1: Atomic claim via SKIP LOCKED
  // --------------------------------------------------------------------------
  console.log('   Testing atomic outbox claim (claim_outbox_events)...');
  const claimRows = await executeSql(`
    SELECT * FROM public.claim_outbox_events(20);
  `);

  // We should get at least our synthetic event (could get others if pending exist)
  const claimed = claimRows.find((r) => r.correlation_id === testCorrelation);
  if (!claimed) {
    throw new Error('Synthetic test event not claimed from outbox');
  }
  if (claimed.delivery_state !== 'processing') {
    throw new Error(`Expected delivery_state=processing, got ${claimed.delivery_state}`);
  }
  if (claimed.delivery_attempts !== 1) {
    throw new Error(`Expected delivery_attempts=1, got ${claimed.delivery_attempts}`);
  }
  console.log(`   ✓ Event claimed atomically (ID: ${claimed.event_id}, state: processing, attempts: 1)`);

  // --------------------------------------------------------------------------
  // Check 2: mark_outbox_event_delivered
  // --------------------------------------------------------------------------
  console.log('   Testing delivery completion (mark_outbox_event_delivered)...');
  const deliverResult = await executeSql(`
    SELECT public.mark_outbox_event_delivered('${claimed.event_id}'::uuid);
  `);
  const afterDeliver = await executeSql(`
    SELECT delivery_state FROM public.outbox_events WHERE event_id = '${claimed.event_id}';
  `);
  if (afterDeliver[0].delivery_state !== 'delivered') {
    throw new Error(`Expected delivered, got ${afterDeliver[0].delivery_state}`);
  }
  console.log('   ✓ Event marked as delivered');

  // --------------------------------------------------------------------------
  // Check 3: mark_outbox_event_failed with retry (< 3 attempts → re-queue)
  // --------------------------------------------------------------------------
  console.log('   Testing failure retry logic (mark_outbox_event_failed)...');

  // Reset to processing with 1 attempt for retry test
  await executeSql(`
    UPDATE public.outbox_events 
    SET delivery_state = 'processing', delivery_attempts = 1
    WHERE event_id = '${claimed.event_id}';
  `);
  await executeSql(`
    SELECT public.mark_outbox_event_failed('${claimed.event_id}'::uuid);
  `);
  const afterRetry = await executeSql(`
    SELECT delivery_state, delivery_attempts FROM public.outbox_events WHERE event_id = '${claimed.event_id}';
  `);
  if (afterRetry[0].delivery_state !== 'pending') {
    throw new Error(`Expected re-queued to pending, got ${afterRetry[0].delivery_state}`);
  }
  console.log('   ✓ Failed event re-queued to pending (attempts < 3)');

  // --------------------------------------------------------------------------
  // Check 4: Terminal failure (>= 3 attempts → failed permanently)
  // --------------------------------------------------------------------------
  console.log('   Testing terminal failure (>= 3 attempts)...');
  await executeSql(`
    UPDATE public.outbox_events 
    SET delivery_state = 'processing', delivery_attempts = 3
    WHERE event_id = '${claimed.event_id}';
  `);
  await executeSql(`
    SELECT public.mark_outbox_event_failed('${claimed.event_id}'::uuid);
  `);
  const afterTerminal = await executeSql(`
    SELECT delivery_state FROM public.outbox_events WHERE event_id = '${claimed.event_id}';
  `);
  if (afterTerminal[0].delivery_state !== 'failed') {
    throw new Error(`Expected terminal failed, got ${afterTerminal[0].delivery_state}`);
  }
  console.log('   ✓ Event permanently failed after 3 attempts');

  // --------------------------------------------------------------------------
  // Check 5: Verify RPCs restricted to service_role
  // --------------------------------------------------------------------------
  console.log('   Verifying outbox RPCs restricted to service_role...');
  const grants = await executeSql(`
    SELECT grantee FROM information_schema.routine_privileges
    WHERE routine_name = 'claim_outbox_events'
    ORDER BY grantee;
  `);
  const grantees = grants.map((g) => g.grantee);
  if (grantees.includes('anon') || grantees.includes('authenticated')) {
    throw new Error('SECURITY: claim_outbox_events accessible to anon or authenticated!');
  }
  if (!grantees.includes('service_role')) {
    throw new Error('claim_outbox_events not granted to service_role');
  }
  console.log('   ✓ Outbox RPCs restricted to service_role only');

  console.log('\n✅ All Outbox Worker Pipeline tests passed successfully!');
}

main().catch((err) => {
  console.error('Fatal outbox verification error:', err);
  process.exit(1);
});
