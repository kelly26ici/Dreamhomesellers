'use client';

/**
 * Owner onboarding form — creates the caller's solo organization.
 *
 * This is the only component on the /owner surface that performs a write,
 * and it runs in the browser because the form needs per-keystroke state.
 * All authority stays server-side: the browser client carries the session
 * cookie to `create_solo_organization` (migration 0003), a SECURITY
 * DEFINER RPC that re-checks authentication and creates the org +
 * owner-membership rows in one transaction. A second org for the same
 * user is rejected by the RPC, so double-submit is safe.
 *
 * Success path: router.refresh() — the /owner page is a server component
 * behind a Suspense boundary, so a refresh re-runs the gate. With the org
 * now existing, the portal re-resolves to the listings overview without
 * any client-side routing state to maintain.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createSoloOrganization } from '@/lib/owner/write-model';

/** reason_code → user copy. The RPC's documented rejections for this call
 *  are membership conflicts and validation; anything unknown falls back. */
const REJECTION_MESSAGES: Record<string, string> = {
  not_authenticated:
    'Your session has expired. Sign in again and retry.',
  already_member:
    'You already belong to an organization. Refresh the portal to continue.',
  invalid_display_name:
    'The organization name needs to be between 2 and 120 characters.',
  idempotency_conflict:
    'A request with this reference is already in flight — try again in a moment.',
  unexpected_response:
    'The server replied with an unexpected shape. Try again; if it persists, contact LUXONN support.',
};

export function OwnerOnboardingForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [publicBio, setPublicBio] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmedName = displayName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      setError(REJECTION_MESSAGES.invalid_display_name);
      return;
    }

    setSubmitting(true);
    setError(null);

    const trimmedBio = publicBio.trim();
    const result = await createSoloOrganization(
      trimmedName,
      trimmedBio === '' ? null : trimmedBio,
    );

    if (!result.ok) {
      setSubmitting(false);
      setError(
        REJECTION_MESSAGES[result.reasonCode] ??
          result.message ??
          'Something went wrong. Try again.',
      );
      return;
    }

    // The org exists; re-run the server gate so the portal swaps from this
    // form to the listings overview.
    setCreated(true);
    setSubmitting(false);
    router.refresh();
  }

  if (created) {
    return (
      <p className="mt-6 text-sm text-emerald-300" role="status">
        Organization created. Loading your listings…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-4">
      <div>
        <label
          htmlFor="org-display-name"
          className="block text-xs tracking-[0.2em] text-gold"
        >
          ORGANIZATION NAME
        </label>
        <input
          id="org-display-name"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Jane Wanjiru Residences"
          disabled={submitting}
          className="mt-2 w-full rounded-md border border-gold/20 bg-surface-2/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-gold/50 focus:outline-none disabled:opacity-50"
        />
      </div>

      <div>
        <label
          htmlFor="org-public-bio"
          className="block text-xs tracking-[0.2em] text-gold"
        >
          PUBLIC BIO <span className="text-muted">(optional)</span>
        </label>
        <textarea
          id="org-public-bio"
          rows={3}
          maxLength={500}
          value={publicBio}
          onChange={(e) => setPublicBio(e.target.value)}
          placeholder="A short line buyers will see next to your listings."
          disabled={submitting}
          className="mt-2 w-full resize-none rounded-md border border-gold/20 bg-surface-2/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-gold/50 focus:outline-none disabled:opacity-50"
        />
      </div>

      {error !== null && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create organization'}
      </button>
    </form>
  );
}
