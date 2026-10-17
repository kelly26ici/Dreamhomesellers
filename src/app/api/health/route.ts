import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicKey, getSupabaseUrl } from "@/lib/auth/supabase-key";

export async function GET() {
  try {
    const supabaseUrl = getSupabaseUrl();
    const anonKey = getSupabasePublicKey();

    const supabase = createClient(supabaseUrl, anonKey);

    const { data, error } = await supabase.rpc('get_platform_operational_health');

    if (error) {
      return NextResponse.json(
        {
          status: 'degraded',
          error: error.message,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
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
      { status: 500 }
    );
  }
}
