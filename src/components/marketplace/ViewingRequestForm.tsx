"use client";

/**
 * Viewing-request form (ADR-016). The only client write path into
 * viewing_requests is the `create_viewing_request` RPC — the form never
 * inserts directly. Anonymous and signed-in buyers both may submit;
 * authenticated buyers naming their Supabase-verified email get in-band
 * verification server-side (`open` directly), everyone else lands in
 * `pending_contact_verification`.
 */

import { useState, type FormEvent } from 'react';

import { getSupabaseBrowserClient } from '@/lib/auth/supabase-browser';

interface CreateViewingRequestResult {
  ok: boolean;
  idempotent_replay?: boolean;
  request_id?: string;
  reference?: string;
  request_state?: string;
  reason_code?: string;
  message?: string;
}

const REJECTION_MESSAGES: Record<string, string> = {
  invalid_input: 'Something went wrong preparing this request. Please reload and try again.',
  listing_not_found: 'This listing is no longer available.',
  listing_not_available: 'This listing is not open for viewing requests.',
  invalid_contact: 'Please check your contact details — a valid email or phone number is required.',
  invalid_consent: 'Consent must be given in the LUXONN interface to continue.',
  invalid_purpose: 'Please describe why you want to view (up to 500 characters).',
  invalid_slot: 'Please choose a future date and time, with a duration between 15 minutes and 8 hours.',
  rate_limited: 'You have sent several viewing requests recently. Please try again after 24 hours.',
};

export default function ViewingRequestForm({
  listingId,
  title,
}: {
  listingId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [contactValue, setContactValue] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [statedPurpose, setStatedPurpose] = useState('');
  const [viewingDate, setViewingDate] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [mode, setMode] = useState<'in_person' | 'virtual'>('in_person');
  const [notes, setNotes] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    reference: string;
    requestState: string;
    replay: boolean;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!consentChecked) {
      setFormError('Please confirm consent to share your contact details.');
      return;
    }

    const viewingDateMs = Date.parse(viewingDate);
    if (Number.isNaN(viewingDateMs) || viewingDateMs <= Date.now()) {
      setFormError('Please choose a future viewing date and time.');
      return;
    }

    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
      setFormError('Duration must be between 15 minutes and 8 hours.');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await getSupabaseBrowserClient().rpc(
        'create_viewing_request',
        {
          p_listing_id: listingId,
          p_contact: {
            channel,
            value: contactValue.trim(),
            display_name: displayName.trim() || null,
          },
          p_consent: {
            provenance: 'native',
            purpose: 'Contact the requester about this viewing request.',
          },
          p_stated_purpose: statedPurpose.trim(),
          p_preferred_slot: {
            viewing_date: new Date(viewingDateMs).toISOString(),
            duration_minutes: duration,
            alternate_viewing_date: null,
            mode,
          },
          p_notes: notes.trim() || null,
          // Stable per form-fill; replays return the original result
          // instead of creating a duplicate request.
          p_idempotency_key: `web:${crypto.randomUUID()}`,
        },
      );

      if (error) {
        setFormError('Could not submit the request. Please try again.');
        return;
      }

      const result = data as CreateViewingRequestResult;
      if (!result.ok) {
        setFormError(
          (result.reason_code && REJECTION_MESSAGES[result.reason_code]) ||
            result.message ||
            'Could not submit the request. Please try again.',
        );
        return;
      }

      setConfirmation({
        reference: result.reference ?? '',
        requestState: result.request_state ?? '',
        replay: result.idempotent_replay === true,
      });
    } catch {
      setFormError('Could not submit the request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <section
        aria-label="Viewing request received"
        className="glass rounded-lg p-6"
      >
        <h2 className="font-display text-2xl tracking-wide text-white">
          Request received
        </h2>
        <p className="mt-2 text-sm text-muted">
          {confirmation.replay
            ? 'You already sent this request — here is its reference again.'
            : 'Your viewing request has been recorded.'}
        </p>
        <p className="mt-4 text-sm text-white">
          Reference{' '}
          <span className="font-semibold tracking-widest text-gold">
            {confirmation.reference}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted">
          {confirmation.requestState === 'open'
            ? 'Your verified email confirmed the request — the owner can respond now.'
            : 'Verify your contact details to make this request visible to the owner.'}
        </p>
      </section>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md bg-gold px-4 py-3 text-sm tracking-widest text-black transition-opacity hover:opacity-90"
      >
        REQUEST A VIEWING
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Request a viewing"
      className="glass rounded-lg p-6"
    >
      <h2 className="font-display text-2xl tracking-wide text-white">
        Request a viewing
      </h2>
      <p className="mt-1 text-sm text-muted">About {title}</p>

      {formError && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {formError}
        </p>
      )}

      <div className="mt-5 space-y-4">
        <div className="flex gap-2">
          {(['email', 'phone'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              aria-pressed={channel === c}
              className={`flex-1 rounded-md border px-3 py-2 text-xs tracking-widest transition-colors ${
                channel === c
                  ? 'border-gold text-gold'
                  : 'border-white/20 text-muted hover:border-white/40 hover:text-white'
              }`}
            >
              {c === 'email' ? 'EMAIL' : 'PHONE'}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-[10px] tracking-[0.2em] text-muted uppercase">
            {channel === 'email' ? 'Email address' : 'Phone number'}
          </span>
          <input
            type={channel === 'email' ? 'email' : 'tel'}
            value={contactValue}
            onChange={(event) => setContactValue(event.target.value)}
            required
            disabled={submitting}
            className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[10px] tracking-[0.2em] text-muted uppercase">
            Name (optional)
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={120}
            disabled={submitting}
            className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[10px] tracking-[0.2em] text-muted uppercase">
            Why do you want to view?
          </span>
          <textarea
            value={statedPurpose}
            onChange={(event) => setStatedPurpose(event.target.value)}
            required
            maxLength={500}
            rows={3}
            disabled={submitting}
            className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] tracking-[0.2em] text-muted uppercase">
              Date & time
            </span>
            <input
              type="datetime-local"
              value={viewingDate}
              onChange={(event) => setViewingDate(event.target.value)}
              required
              disabled={submitting}
              className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] tracking-[0.2em] text-muted uppercase">
              Duration (minutes)
            </span>
            <input
              type="number"
              min={15}
              max={480}
              step={15}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              required
              disabled={submitting}
              className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
            />
          </label>
        </div>

        <div className="flex gap-2">
          {(['in_person', 'virtual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`flex-1 rounded-md border px-3 py-2 text-xs tracking-widest transition-colors ${
                mode === m
                  ? 'border-gold text-gold'
                  : 'border-white/20 text-muted hover:border-white/40 hover:text-white'
              }`}
            >
              {m === 'in_person' ? 'IN PERSON' : 'VIRTUAL'}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-[10px] tracking-[0.2em] text-muted uppercase">
            Notes (optional, max 1000)
          </span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={1000}
            rows={2}
            disabled={submitting}
            className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
          />
        </label>

        <label className="flex items-start gap-3 text-xs leading-relaxed text-muted">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(event) => setConsentChecked(event.target.checked)}
            required
            disabled={submitting}
            className="mt-0.5 accent-[#d4a95f]"
          />
          <span>
            I consent to LUXONN storing my contact details and passing them
            to the listing owner, solely to arrange this viewing.
          </span>
        </label>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-md bg-gold px-4 py-2.5 text-sm tracking-widest text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Sending…' : 'SEND REQUEST'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="rounded-md border border-white/20 px-4 py-2.5 text-sm tracking-widest text-muted transition-colors hover:border-white/50 hover:text-white"
          >
            CANCEL
          </button>
        </div>
      </div>
    </form>
  );
}