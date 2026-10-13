/**
 * /oauth/consent — the OAuth 2.1 authorization UI (Supabase OAuth Server).
 *
 * Third-party OAuth clients redirect here with ?authorization_id=…; Supabase
 * Auth hands the decision back to us via approveAuthorization /
 * denyAuthorization in the POST route. The shell (branding, glass frame)
 * prerenders; the session-and-details work streams inside Suspense because
 * it reads cookies, which cacheComponents forbids in the static shell.
 */

import { Suspense } from 'react';

export const metadata = {
  title: 'Authorize — LUXONN',
};

export default function ConsentPage(props: PageProps<'/oauth/consent'>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <p className="text-center text-xs tracking-[0.3em] text-gold">
          LUXONN
        </p>
        <Suspense fallback={<ConsentSkeleton />}>
          <Consent searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

function ConsentSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading authorization request"
      className="mt-6 glass rounded-xl p-6"
    >
      <div className="h-6 w-40 animate-pulse rounded bg-surface-2" />
      <div className="mt-4 h-4 w-full animate-pulse rounded bg-surface-2" />
      <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 flex gap-3">
        <div className="h-10 flex-1 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-10 flex-1 animate-pulse rounded-lg bg-surface-2" />
      </div>
    </div>
  );
}

async function Consent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { authorization_id: authorizationId } = await searchParams;
  if (typeof authorizationId !== 'string' || authorizationId === '') {
    return <ConsentError message="Missing authorization request." />;
  }

  const { createAuthServerClient } = await import('@/lib/auth/supabase-server');
  const supabase = await createAuthServerClient();

  // Who is consenting? An unsigned-in visitor must authenticate first,
  // preserving the authorization_id so the consent lands on the same
  // request after sign-in (the login form redirects back via ?next=).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const signInHref = `/login?next=${encodeURIComponent(
      `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`,
    )}`;
    return (
      <div role="alert" className="mt-6 glass rounded-xl p-6">
        <h1 className="font-display text-xl tracking-wide text-white">
          Sign in to continue
        </h1>
        <p className="mt-2 text-sm text-muted">
          This authorization needs a signed-in LUXONN account.
        </p>
        <a
          href={signInHref}
          className="mt-5 block rounded-lg bg-gold px-4 py-2.5 text-center text-sm tracking-widest text-black transition-opacity hover:opacity-90"
        >
          SIGN IN
        </a>
      </div>
    );
  }

  const { data: authDetails, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !authDetails) {
    return (
      <ConsentError
        message={error?.message ?? 'Invalid or expired authorization request.'}
      />
    );
  }

  // Previously consented (or an immediate-grant flow): Supabase returns
  // no authorization_id — the redirect_url alone completes the round trip.
  if (!('authorization_id' in authDetails)) {
    const redirectUrl =
      typeof authDetails['redirect_url'] === 'string'
        ? authDetails['redirect_url']
        : '/';
    return <meta httpEquiv="refresh" content={`0; url=${redirectUrl}`} />;
  }

  const clientName =
    typeof authDetails.client === 'object' &&
    authDetails.client !== null &&
    'name' in authDetails.client
      ? String((authDetails.client as { name: unknown }).name)
      : 'Unknown application';
  const redirectUri =
    typeof authDetails['redirect_uri'] === 'string'
      ? authDetails['redirect_uri']
      : '—';
  const scopes =
    typeof authDetails['scope'] === 'string' && authDetails['scope'].trim()
      ? authDetails['scope'].split(' ').filter(Boolean)
      : [];

  return (
    <section
      aria-label="Authorization request"
      className="mt-6 glass rounded-xl p-6"
    >
      <h1 className="font-display text-2xl tracking-wide text-white">
        Authorize {clientName}
      </h1>
      <p className="mt-2 text-sm text-muted">
        This application wants to access your LUXONN account.
      </p>

      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="text-[10px] tracking-[0.2em] text-muted uppercase">
            Application
          </dt>
          <dd className="text-white">{clientName}</dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[0.2em] text-muted uppercase">
            Redirect URI
          </dt>
          <dd className="break-all text-white/90">{redirectUri}</dd>
        </div>
        {scopes.length > 0 && (
          <div>
            <dt className="text-[10px] tracking-[0.2em] text-muted uppercase">
              Requested permissions
            </dt>
            <dd>
              <ul className="mt-1 flex flex-wrap gap-2">
                {scopes.map((scopeItem) => (
                  <li
                    key={scopeItem}
                    className="rounded-full border border-gold/40 px-3 py-1 text-xs text-gold"
                  >
                    {scopeItem}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>

      <form action="/api/oauth/decision" method="POST" className="mt-6 flex gap-3">
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <button
          type="submit"
          name="decision"
          value="approve"
          className="flex-1 rounded-lg bg-gold px-4 py-2.5 text-sm tracking-widest text-black transition-opacity hover:opacity-90"
        >
          APPROVE
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="flex-1 rounded-lg border border-white/20 px-4 py-2.5 text-sm tracking-widest text-muted transition-colors hover:border-white/50 hover:text-white"
        >
          DENY
        </button>
      </form>
    </section>
  );
}

function ConsentError({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-6 glass rounded-xl p-6">
      <h1 className="font-display text-xl tracking-wide text-white">
        Authorization
      </h1>
      <p className="mt-2 text-sm text-muted">{message}</p>
    </div>
  );
}
