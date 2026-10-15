/**
 * Session refresh (Next.js 16 "Proxy", the middleware successor). The
 * Supabase access token lives in a cookie that expires; only request-time
 * code can rotate it. Every non-static request runs getUser() through a
 * cookie-aware client — if the token is stale, Supabase refreshes it and
 * the Set-Cookie headers are copied onto the response, keeping the
 * session the consent page and the viewing-request RPC depend on alive.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // CSRF posture for cookie-authenticated POSTs: same-origin enforcement.
  // The OAuth consent decision (and any future state-changing POST relying
  // on session cookies) is rejected when the Origin header is present and
  // does not match the request host — a cross-site attacker page cannot
  // forge an approve/deny. Requests without Origin (same-site HTML form
  // posts, curl) still pass: forged cross-site browser posts always carry
  // Origin, which is the threat OAuth CSRF actually needs blocked.
  if (request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin) {
      const host = request.headers.get('host');
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!host || originHost !== host) {
        return NextResponse.json(
          { error: 'Cross-origin form submission rejected.' },
          { status: 403 },
        );
      }
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() contacts the auth server and refreshes the token when
  // needed — getSession() alone trusts an unverified local cookie.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Skip Next internals and static assets; refresh everywhere else.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)'],
};
