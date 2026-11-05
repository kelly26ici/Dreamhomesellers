import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from '@/lib/auth/supabase-key';

/**
 * Platform operational health.
 *
 * Migration 0010 revoked `get_platform_operational_health` from anon and
 * granted it to authenticated + service_role only, so calling it with the
 * public anon key returns PostgreSQL's 42501 "permission denied for function".
 * The old route ran it under the anon key and therefore reported a permanent
 * 503 "permission denied" for every caller, including the Render outbox
 * keep-alive ping — a false alarm that masked the real signal.
 *
 * This route is a server-only Route Handler (no browser bundle imports it),
 * so it is the correct place to use the service-role key: RLS is bypassed,
 * the RPC reads only aggregate platform counters, and no user input reaches
 * the query. The anon revocation from 0010 stays in force for every other
 * path — nothing here re-grants anon.
 */
export async function GET() {
  try {
    const supabaseUrl = getSupabaseUrl();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!serviceRoleKey) {
      // Never fall back to the anon key: that is the exact misconfiguration
      // that produced the permanent 503.
      return NextResponse.json(
        {
          status: 'degraded',
          error:
            'Supabase service role key is not configured on the server. ' +
            'Set SUPABASE_SERVICE_ROLE_KEY in the service environment.',
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc('get_platform_operational_health');

    if (error) {
      return NextResponse.json(
        {
          status: 'degraded',
          error: error.message,
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: err instanceof Error ? err.message : 'Unknown health check failure',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
