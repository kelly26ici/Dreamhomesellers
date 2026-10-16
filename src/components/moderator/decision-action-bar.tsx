'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { decideModerationCase, type ModerationDecisionType } from '@/lib/moderator/write-model';

interface DecisionActionBarProps {
  readonly caseId: string;
  readonly revisionId?: string | null;
  readonly isCaseOpen: boolean;
}

export function DecisionActionBar({ caseId, isCaseOpen }: DecisionActionBarProps) {
  const router = useRouter();
  const [selectedDecision, setSelectedDecision] = useState<ModerationDecisionType | null>(null);
  const [reasonCode, setReasonCode] = useState('standard_review');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isCaseOpen) {
    return (
      <div className="rounded-lg border border-white/10 bg-surface-2/40 p-4 text-center">
        <p className="text-xs tracking-widest text-muted">CASE IS RESOLVED — DECISIONS LOCKED</p>
      </div>
    );
  }

  async function handleExecuteDecision(decision: ModerationDecisionType) {
    if (submitting) return;

    if ((decision === 'request_changes' || decision === 'reject') && note.trim() === '') {
      setError(`A note explaining the ${decision === 'request_changes' ? 'requested changes' : 'rejection'} is required.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await decideModerationCase(
      caseId,
      decision,
      reasonCode,
      note.trim() === '' ? null : note.trim(),
    );

    if (!result.ok) {
      setSubmitting(false);
      setError(result.message || 'Decision failed.');
      return;
    }

    setSuccess(`Decision "${decision}" recorded successfully. Updating listing lifecycle…`);
    setSubmitting(false);
    setSelectedDecision(null);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-gold/20 bg-surface-1/90 p-6 backdrop-blur-md">
      <h3 className="font-heading text-lg tracking-wide text-foreground">Moderator Action</h3>
      <p className="mt-1 text-xs text-muted">
        Audited platform decision. Approved submissions publish immediately to buyers.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300" role="status">
          {success}
        </div>
      )}

      {selectedDecision === null ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => handleExecuteDecision('approve')}
            disabled={submitting}
            className="flex-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs font-semibold tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
          >
            APPROVE & PUBLISH
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedDecision('request_changes');
              setReasonCode('changes_requested');
            }}
            disabled={submitting}
            className="flex-1 rounded-md border border-gold/40 bg-gold/15 px-4 py-2.5 text-xs font-semibold tracking-wider text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
          >
            REQUEST CHANGES
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedDecision('reject');
              setReasonCode('policy_violation');
            }}
            disabled={submitting}
            className="flex-1 rounded-md border border-red-500/40 bg-red-500/15 px-4 py-2.5 text-xs font-semibold tracking-wider text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50"
          >
            REJECT
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="decision-reason" className="block text-[10px] tracking-widest text-gold">
              REASON CODE
            </label>
            <input
              id="decision-reason"
              type="text"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-gold/20 bg-black/60 px-3 py-2 text-xs text-foreground focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="decision-note" className="block text-[10px] tracking-widest text-gold">
              MODERATOR NOTE <span className="text-muted">(visible to owner)</span>
            </label>
            <textarea
              id="decision-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain the required change or rejection reason clearly..."
              className="mt-1 w-full rounded-md border border-gold/20 bg-black/60 px-3 py-2 text-xs text-foreground focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleExecuteDecision(selectedDecision)}
              className="flex-1 rounded-md border border-gold/50 bg-gold/20 px-4 py-2 text-xs font-semibold tracking-wider text-gold hover:bg-gold/30 disabled:opacity-50"
            >
              {submitting ? 'RECORDING…' : `CONFIRM ${selectedDecision.toUpperCase()}`}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setSelectedDecision(null)}
              className="rounded-md border border-white/20 bg-white/5 px-4 py-2 text-xs tracking-wider text-muted hover:bg-white/10"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
