import { NextResponse, type NextRequest } from 'next/server';

import { createAuthServerClient } from '@/lib/auth/supabase-server';

/**
 * Sign-out.
 *
 * POST only. Sign-out is state-changing (it clears the session cookies), so
 * it must not be a GET — a prefetch, a crawler, or any <img>/<link> tag
 * pointing here would silently end the visitor's session. `src/proxy.ts`
 * already enforces same-origin on POSTs carrying cookies, and a plain HTML
 * form post with no Origin header is permitted, so a real form reaches this
 * handler while a cross-site POST does not.
 *
 * A route handler rather than a client `supabase.auth.signOut()`: in SSR
 * mode the session cookies are written through Next's cookie store, and a
 * server component cannot mutate cookies during render. Clearing only the
 * browser client's copy leaves the server-side refresh token alive, which
 * is how "I signed out but the portal still shows my listings" happens.
 */

function originFor(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const host = forwardedHost || req.headers.get('host') || req.nextUrl.host;
  return host.includes('localhost') && !forwardedHost
    ? req.nextUrl.origin
    : `${forwardedProto}://${host}`;
}

export async function POST(req: NextRequest) {
  const origin = originFor(req);
  const nextParam = req.nextUrl.searchParams.get('next');

  // Open-redirect guard, matching /auth/callback: same-site paths only.
  const next =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
      ? nextParam
      : '/';

  const supabase = await createAuthServerClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(`${origin}${next}`, { status: 303 });
}
