import { NextResponse, type NextRequest } from 'next/server';

import { createAuthServerClient } from '@/lib/auth/supabase-server';

/**
 * OAuth + email-link callback.
 *
 * Serves three link types: Google sign-in, email confirmation after
 * sign-up, and password recovery. The PKCE `?code=` form (what the
 * browser client sends) is exchanged server-side; the implicit-flow
 * `#access_token` / `?token_hash=` fallbacks are handled too so a
 * server-generated or misconfigured link still lands a session.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const host = forwardedHost || req.headers.get('host') || req.nextUrl.host;
  const origin = host.includes('localhost') && !forwardedHost ? req.nextUrl.origin : `${forwardedProto}://${host}`;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const nextParam = searchParams.get('next');
  const errorParam = searchParams.get('error_description') ?? searchParams.get('error');

  // Open-redirect guard: only same-site paths, matching the login form.
  const next =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
      ? nextParam
      : '/';

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorParam)}`,
    );
  }

  const supabase = await createAuthServerClient();

  if (code) {
    // PKCE: the browser client's flow (what our own emails carry once the
    // site_url/uri_allow_list are production — set 2026-10-15).
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      );
    }
  } else if (tokenHash) {
    // Email OTP / token-hash confirmation links.
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type === 'recovery' ? 'recovery' : type === 'invite' ? 'invite' : 'signup',
    });
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      );
    }
  } else {
    // No exchangeable credential: bare callback visit.
    return NextResponse.redirect(`${origin}/login`);
  }

  // ADR-012 org bootstrap for first-time sign-ins (Google users land here
  // with no membership). Non-fatal — the owner portal prompts for org
  // creation when it is missing. Recovery sessions skip it: they must
  // update a password, not create tenants.
  if (next !== '/reset-password') {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: memberships } = await supabase
          .from('owner_organizations_memberships')
          .select('organization_id')
          .limit(1);
        if (!memberships || memberships.length === 0) {
          await supabase.rpc('create_solo_organization', {
            p_display_name:
              user.user_metadata?.display_name ??
              user.user_metadata?.full_name ??
              user.email?.split('@')[0] ??
              'My Listings',
            p_idempotency_key: crypto.randomUUID(),
          });
        }
      }
    } catch {
      // Session is already established; never block the redirect on this.
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
