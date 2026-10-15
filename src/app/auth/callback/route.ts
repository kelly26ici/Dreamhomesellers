import { NextResponse, type NextRequest } from 'next/server';

import { createAuthServerClient } from '@/lib/auth/supabase-server';

/**
 * OAuth + email-link callback.
 *
 * One route serves three link types Supabase sends:
 *   - Google sign-in (?code=…)
 *   - Email confirmation after sign-up (?code=…, next=/owner)
 *   - Password recovery (?code=…, next=/reset-password)
 *
 * The PKCE code is exchanged server-side with the cookie-aware client so
 * the new session is written onto the response cookies the proxy refreshes.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');
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

  if (!code) {
    // A bare callback visit (no code): treat as sign-in entry.
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // ADR-012: a first-time Google sign-in has no organization membership,
  // which would strand the user at /owner. Bootstrap the solo org from the
  // Google profile name. Failures are non-fatal (the portal prompts for
  // org creation when the membership is missing) and never block the
  // redirect — the session is already established at this point.
  if (data.user && next !== '/reset-password') {
    try {
      const { data: memberships } = await supabase
        .from('owner_organizations_memberships')
        .select('organization_id')
        .limit(1);
      if (!memberships || memberships.length === 0) {
        await supabase.rpc('create_solo_organization', {
          p_display_name:
            data.user.user_metadata?.display_name ??
            data.user.user_metadata?.full_name ??
            data.user.email?.split('@')[0] ??
            'My Listings',
          p_idempotency_key: crypto.randomUUID(),
        });
      }
    } catch {
      // Non-fatal — see comment above.
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
