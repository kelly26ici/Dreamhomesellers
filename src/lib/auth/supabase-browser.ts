/**
 * Browser-side Supabase auth client. `createBrowserClient` persists the
 * session in cookies (the same storage `createAuthServerClient` reads),
 * so a password sign-in here is what makes the OAuth consent page and
 * the viewing-request RPC's `current_app_user_id()` see a signed-in user.
 *
 * Singleton per browser tab — Supabase warns about multiple GoTrue
 * clients sharing one storage key.
 */

import { createBrowserClient } from '@supabase/ssr';
import { getSupabasePublicKey, getSupabaseUrl } from "./supabase-key";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  client ??= createBrowserClient(
    getSupabaseUrl(),
    getSupabasePublicKey(),
  );
  return client;
}

export const createSupabaseBrowserClient = getSupabaseBrowserClient;
