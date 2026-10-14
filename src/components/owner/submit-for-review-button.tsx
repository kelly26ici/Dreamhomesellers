'use client';

/**
 * Submit-for-review — the DRAFT → SUBMITTED transition (ADR-005).
 *
 * The confirmation step matters: submission opens a moderation case
 * server-side and the revision leaves the owner's editable state, so it
 * is not a one-click action. On success router.refresh() re-runs the
 * server gate; the detail page re-renders with revision_state='submitted'
 * and the action row collapses to a status note.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { submitRevisionForReview } from '@/lib/owner/write-model';

const REJECTION_MESSAGES: Record<string, string> = {
  not_authenticated:
    'Your session has expired. Sign in again and retry.',
  not_authorized:
    'You do not have permission to submit this revision.',
  not_draft:
    'This revision is no longer a draft — refresh to see its current state.',
  idempotency_conflict:
    'A request with this reference is already in flight — try again in a moment.',
  unexpected_response:
    'The server replied with an unexpected shape. Try again; if it persists, contact LUXONN support.',
};

export function SubmitForReviewButton({ revisionId }: { revisionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseReference, setCaseReference] = useState<string | null>(null);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await submitRevisionForReview(revisionId);
    if (!result.ok || result.kind !== 'revision_submitted') {
      setSubmitting(false);
      setError(
        result.ok
          ? 'Unexpected server response. Try again.'
          : (REJECTION_MESSAGES[result.reasonCode] ??
            result.message ??
            'Something went wrong. Try again.'),
      );
      return;
    }

    setCaseReference(result.caseReference);
    setSubmitting(false);
    router.refresh();
  }

  if (caseReference !== null) {
    return (
      <p className="text-sm text-emerald-300" role="status">
        Submitted — moderation case {caseReference}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20"
      >
        Submit for review
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">
        This opens a moderation case and locks the draft. Submit?
      </span>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={submitting}
        className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Yes, submit'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={submitting}
        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
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
