/**
 * The single place the website authenticates to Simon.
 *
 * Simon requires a shared-secret header on every endpoint except /api/health.
 * Without it the relay would be rejected the moment Simon's auth middleware is
 * live — and before that, POST /api/aux was an unauthenticated 8,000-character
 * LLM proxy open to anyone who knew the URL.
 *
 * Configured by SIMON_SHARED_SECRET, which must hold the same value on both
 * Render services. Absent means the header is omitted, which is what local
 * development and any not-yet-migrated deploy need: Simon only enforces the
 * check when it has a secret configured, so an empty value here fails open
 * exactly as hard as Simon does.
 */

/** The header name Simon's auth middleware reads. */
export const SIMON_SECRET_HEADER = 'x-simon-secret';

/**
 * Headers every outbound Simon request should carry.
 *
 * Always includes Content-Type, because all four call sites previously wrote
 * it by hand and one day one of them would forget.
 */
export function simonRequestHeaders(): Record<string, string> {
  const secret = process.env.SIMON_SHARED_SECRET?.trim();
  return {
    'Content-Type': 'application/json',
    ...(secret ? { [SIMON_SECRET_HEADER]: secret } : {}),
  };
}

/**
 * Just the credential, for requests that must set their own Content-Type or
 * Accept — the SSE subscribe in the streaming relay, which asks for
 * text/event-stream rather than JSON.
 */
export function simonSecretHeader(): Record<string, string> {
  const secret = process.env.SIMON_SHARED_SECRET?.trim();
  return secret ? { [SIMON_SECRET_HEADER]: secret } : {};
}
