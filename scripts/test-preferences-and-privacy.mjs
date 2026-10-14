#!/usr/bin/env node

/**
 * LUXONN Buyer Preferences, Privacy Deletion & Health Verification Suite
 *
 * Implements verification for Phase 6 Step 3 & Step 5:
 * - Operational health telemetry endpoint & RPC (get_platform_operational_health)
 * - Buyer structured preferences with consent flags (upsert_buyer_preferences, get_buyer_preferences)
 * - Privacy purge & right-to-be-forgotten deletion cascade (purge_buyer_personal_data)
 * - Audit logging of privacy purge actions
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
  console.log('🛡️  Running LUXONN Preferences, Privacy Purge & Telemetry Verification Suite...\n');

  // --------------------------------------------------------------------------
  // Check 1: Operational Health Telemetry
  // --------------------------------------------------------------------------
  console.log('   Testing operational health telemetry (get_platform_operational_health)...');
  const healthResult = await executeSql(`
    SELECT public.get_platform_operational_health() AS health;
  `);

  const health = healthResult[0].health;
  if (health.status !== 'healthy') {
    throw new Error(`Platform health check reported non-healthy: ${JSON.stringify(health)}`);
  }
  console.log(`   ✓ Health status confirmed: ${health.status} (Published listings: ${health.metrics.published_listings}, Pending outbox: ${health.metrics.pending_outbox_events})`);

  // --------------------------------------------------------------------------
  // Check 2: Buyer Preferences Lifecycle (using a test user context)
  // --------------------------------------------------------------------------
  console.log('   Testing buyer preferences upsert and retrieval...');

  // Fetch or create a test user ID from auth.users
  const userRows = await executeSql(`
    SELECT id FROM auth.users LIMIT 1;
  `);
  if (!userRows || userRows.length === 0) {
    throw new Error('No test user available in auth.users');
  }
  const testUserId = userRows[0].id;

  // Insert preferences directly or through authenticated role context
  await executeSql(`
    INSERT INTO public.buyer_preferences (
      user_id, preferred_cities, preferred_areas, preferred_property_types,
      budget_min, budget_max, budget_currency, min_bedrooms, preferred_amenities,
      investment_purpose, consent_marketing, consent_ai_personalization
    ) VALUES (
      '${testUserId}',
      ARRAY['Nairobi'],
      ARRAY['Karen', 'Runda'],
      ARRAY['villa', 'townhouse'],
      50000000,
      150000000,
      'KES',
      4,
      ARRAY['private swimming pool', 'borehole'],
      'primary_residence',
      false,
      true
    )
    ON CONFLICT (user_id) DO UPDATE SET
      preferred_areas = EXCLUDED.preferred_areas,
      updated_at = now();
  `);

  const prefRows = await executeSql(`
    SELECT user_id, preferred_areas, budget_max, consent_ai_personalization 
    FROM public.buyer_preferences 
    WHERE user_id = '${testUserId}';
  `);
  if (prefRows.length === 0) throw new Error('Buyer preferences row not found in Postgres');
  console.log(`   ✓ Buyer preferences verified in Postgres (User: ${testUserId}, Areas: ${prefRows[0].preferred_areas})`);

  // --------------------------------------------------------------------------
  // Check 3: Right-to-be-Forgotten Privacy Purge
  // --------------------------------------------------------------------------
  console.log('   Testing privacy purge deletion cascade...');

  // Create a synthetic conversation thread for the test user
  const testThreadId = crypto.randomUUID();
  await executeSql(`
    INSERT INTO public.conversation_threads (
      thread_id, user_id, session_id, page_context
    ) VALUES (
      '${testThreadId}', '${testUserId}', 'purge_sess', '{"route": "/properties"}'::jsonb
    );
    INSERT INTO public.conversation_messages (
      message_id, thread_id, role, content
    ) VALUES (
      gen_random_uuid(), '${testThreadId}', 'user', 'Confidential buyer notes to purge'
    );
  `);

  // Execute purge via SECURITY DEFINER domain RPC
  const purgeRes = await executeSql(`
    DO $$
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', '${testUserId}', true);
      PERFORM set_config('role', 'authenticated', true);
    END $$;

    SELECT public.purge_buyer_personal_data() AS res;
  `);

  const purgeData = purgeRes[0].res;
  if (!purgeData.ok) {
    throw new Error(`purge_buyer_personal_data failed: ${JSON.stringify(purgeData)}`);
  }

  // Verify deletion
  const verifyPref = await executeSql(`
    SELECT count(*) FROM public.buyer_preferences WHERE user_id = '${testUserId}';
  `);
  const verifyThread = await executeSql(`
    SELECT count(*) FROM public.conversation_threads WHERE user_id = '${testUserId}';
  `);

  if (parseInt(verifyPref[0].count) !== 0 || parseInt(verifyThread[0].count) !== 0) {
    throw new Error('Privacy purge failed: records remain in database after purge!');
  }
  console.log('   ✓ Privacy Purge confirmed: preferences and conversation threads completely deleted');

  // Verify audit trail entry
  const auditPurge = await executeSql(`
    SELECT action, outcome, reason_code 
    FROM public.audit_records 
    WHERE actor_id = '${testUserId}' AND action = 'privacy.purge_personal_data'
    ORDER BY occurred_at DESC LIMIT 1;
  `);
  if (!auditPurge || auditPurge.length === 0) {
    throw new Error('Privacy purge audit trail missing');
  }
  console.log(`   ✓ Privacy audit record confirmed (${auditPurge[0].action} -> ${auditPurge[0].outcome})`);

  console.log('\n✅ All Preferences, Privacy Purge & Telemetry tests passed successfully!');
}

main().catch((err) => {
  console.error('Fatal privacy verification error:', err);
  process.exit(1);
});
