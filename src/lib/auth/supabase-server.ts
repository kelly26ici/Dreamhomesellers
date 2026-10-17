/**
 * Server-side, cookie-aware Supabase auth client for the OAuth consent
 * surfaces (ADR-016's trusted front door: /oauth/consent + its decision
 * route). Unlike the buyer read model's stateless anon client, the consent
 * flow must act AS the signed-in user — the browser's Supabase session
 * cookie is the only thing that proves who is approving, so every call
 * here carries the request cookies and writes Set-Cookie back through
 * Next's cookie store.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabasePublicKey, getSupabaseUrl } from "./supabase-key";

export async function createAuthServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabasePublicKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server components cannot mutate cookies during render —
            // only middleware refreshes sessions there. The consent page
            // only READS the session, so a failed refresh write is fine.
          }
        },
      },
    },
  );
}
