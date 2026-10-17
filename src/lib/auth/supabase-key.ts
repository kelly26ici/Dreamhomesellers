/**
 * Which Supabase public key the app should use.
 *
 * The auth clients read `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and the
 * marketplace read-model reads `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Render defines
 * only one of the two names, so on the deployed service one code path or the
 * other got `undefined`:
 *
 *     Error: Your project's URL and Key are required to create a Supabase
 *     client!  Check your Supabase project's API settings to find these values
 *
 * ...which returned HTTP 500 on every route, while `next build` still passed
 * and `next start` still worked from a developer checkout whose .env.local
 * happens to define the other name. A missing-env-variable fault that only
 * reproduces in the deployed environment is the expensive kind.
 *
 * Both names refer to the SAME kind of credential — a public, RLS-restricted
 * client key. Supabase labels it "anon" on one settings tab and "publishable"
 * on the newer one, and a project carries whichever its creation date implies.
 * Neither is a secret. So accepting either name is correctness, not a fallback
 * that papers over a misconfiguration.
 *
 * The service_role key is deliberately NOT accepted here: it bypasses RLS and
 * is server-only, so an accidental swap-in would be a security hole rather than
 * a bug. If that is all that is configured, fail loudly and say why.
 */

const ANON = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const PUBLISHABLE = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

/** The project URL, with fail-fast-and-explain behaviour. */
export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (url) return url;
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL is not set — the Supabase client cannot be " +
      "constructed without it.",
  );
}

/**
 * The public, RLS-restricted client key.
 *
 * Order: publishable first (the newer, preferred form), then anon. Both are the
 * same kind of key, so preferring one is about convention, not capability.
 */
export function getSupabasePublicKey(): string {
  const publishable = process.env[PUBLISHABLE]?.trim();
  if (publishable) return publishable;

  const anon = process.env[ANON]?.trim();
  if (anon) return anon;

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  throw new Error(
    `No Supabase public key configured. Set ${PUBLISHABLE} or ${ANON} in the ` +
      "environment — both names refer to the same public RLS-restricted client " +
      `key.${
        serviceRole
          ? " A service_role key IS present, but it bypasses RLS and must never " +
            "be used from a client; leave it out of this variable."
          : ""
      }`,
  );
}

/** For diagnostics: which variable name actually resolved, without its value. */
export function supabaseKeySource(): PUBLISHABLE_KEY_NAME | ANON_KEY_NAME | "none" {
  if (process.env[PUBLISHABLE]?.trim()) return PUBLISHABLE;
  if (process.env[ANON]?.trim()) return ANON;
  return "none";
}

type PUBLISHABLE_KEY_NAME = typeof PUBLISHABLE;
type ANON_KEY_NAME = typeof ANON;
