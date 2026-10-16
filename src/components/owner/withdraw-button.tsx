'use client';

/**
 * Withdraw — the PUBLISHED → WITHDRAWN transition (ADR-005). The only
 * owner-side edge out of published in Phase 2: re-entry is a fresh draft
 * (no relist edge exists in the state machine).
 *
 * Double confirmation (button → typed phrase not needed; two clicks) keeps
 * the irreversible-seeming action deliberate. On success router.refresh()
 * re-renders the detail page with lifecycle_state='withdrawn'.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { withdrawListing } from '@/lib/owner/write-model';

const REJECTION_MESSAGES: Record<string, string> = {
  not_authenticated:
    'Your session has expired. Sign in again and retry.',
  not_authorized:
    'You do not have permission to withdraw this listing.',
  not_published:
    'This listing is no longer published — refresh to see its current state.',
  idempotency_conflict:
    'A request with this reference is already in flight — try again in a moment.',
  unexpected_response:
    'The server replied with an unexpected shape. Try again; if it persists, contact LUXONN support.',
};

export function WithdrawButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await withdrawListing(listingId);
    if (!result.ok) {
      setSubmitting(false);
      setError(
        REJECTION_MESSAGES[result.reasonCode] ??
          result.message ??
          'Something went wrong. Try again.',
      );
      return;
    }

    setWithdrawn(true);
    setSubmitting(false);
    router.refresh();
  }

  if (withdrawn) {
    return (
      <p className="text-sm text-emerald-300" role="status">
        Listing withdrawn. It no longer appears on the public site.
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm tracking-wide text-red-300 transition-colors hover:bg-red-500/20"
      >
        Withdraw listing
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">
        This removes the listing from the public site. Withdraw?
      </span>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={withdrawn || submitting}
        className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm tracking-wide text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Withdrawing…' : 'Yes, withdraw'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={submitting}
        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        Cancel
      </button>
      {error !== null && (
        <p className="w-full rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
