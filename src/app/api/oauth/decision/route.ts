/**
 * POST /api/oauth/decision — completes the consent round trip.
 *
 * The consent page's plain HTML form posts here (no JS required);
 * approveAuthorization / denyAuthorization run server-side with the
 * user's session cookies attached, and the browser is 302'd to the
 * redirect_url Supabase hands back (authorization code toward the
 * client on approve; error parameters on deny).
 */

import { NextResponse } from 'next/server';

import { createAuthServerClient } from '@/lib/auth/supabase-server';

export async function POST(request: Request) {
  const formData = await request.formData();
  const decision = formData.get('decision');
  const authorizationId = formData.get('authorization_id');

  if (
    typeof authorizationId !== 'string' ||
    authorizationId === '' ||
    (decision !== 'approve' && decision !== 'deny')
  ) {
    return NextResponse.json(
      { error: 'Missing authorization_id or invalid decision.' },
      { status: 400 },
    );
  }

  const supabase = await createAuthServerClient();

  if (decision === 'approve') {
    const { data, error } =
      await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Approval failed.' },
        { status: 400 },
      );
    }
    return NextResponse.redirect(data.redirect_url);
  }

  const { data, error } =
    await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Denial failed.' },
      { status: 400 },
    );
  }
  return NextResponse.redirect(data.redirect_url);
}
