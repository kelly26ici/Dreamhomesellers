'use client';

/**
 * Buyer grid filter bar (client island).
 *
 * Three questions only: what type of home, where, and what budget. The
 * offer kind, bedrooms, free-text search, and sort controls were removed —
 * they made the first screen feel like a form. The URL still carries the
 * full filter vocabulary for old links, but any interaction here writes a
 * clean state.
 *
 * Owns the URL write side of ADR-006: every control change serializes the
 * new state with buildListingUrl and pushes it with router.replace — no
 * history spam, the URL is always shareable. It receives current state as
 * props (parsed server-side by the page) and re-renders from props, so the
 * component stays dumb and the server stays the source of truth.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { buildListingUrl } from '@/lib/marketplace/url-state';
import type { ListingFilters } from '@/lib/marketplace/read-model';

export interface FilterBarProps {
  readonly filters: ListingFilters;
  readonly counties: readonly string[];
  readonly types: readonly string[];
  /** Total matched listings, for the result line. */
  readonly total: number;
}

const inputClass =
  'glass rounded-md px-3 py-2 text-sm text-white placeholder:text-muted ' +
  'outline-none focus:ring-1 focus:ring-gold';

export default function FilterBar({
  filters,
  counties,
  types,
  total,
}: FilterBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Two controls can change in the same tick (blurring the price input to
  // click a select). Composing against the last write keeps both changes
  // instead of letting the second replace drop the first.
  const pending = useRef<ListingFilters | null>(null);

  useEffect(() => {
    // A new server render is the authority; stop composing against the
    // previous optimistic state.
    pending.current = null;
  }, [filters]);

  function update(patch: Partial<ListingFilters>) {
    const next: ListingFilters = {
      ...(pending.current ?? filters),
      // Params the bar no longer exposes are dropped on the next write so a
      // stale shared URL cannot keep hiding listings invisibly.
      q: undefined,
      kinds: undefined,
      minBedrooms: undefined,
      ...patch,
      page: 1,
    };
    pending.current = next;
    startTransition(() => {
      router.replace(buildListingUrl(next), { scroll: false });
    });
  }

  function clearAll() {
    pending.current = null;
    startTransition(() => {
      router.replace('/properties', { scroll: false });
    });
  }

  const hasFilters = Boolean(
    filters.q ||
      filters.kinds?.length ||
      filters.county ||
      filters.type ||
      filters.minBedrooms != null ||
      filters.minPrice != null ||
      filters.maxPrice != null ||
      filters.sort !== 'newest',
  );

  return (
    <section
      aria-label="Search filters"
      className="border-b"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
        <select
          aria-label="Property type"
          value={filters.type ?? ''}
          onChange={(e) => update({ type: e.target.value || undefined })}
          className={`${inputClass} capitalize`}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          aria-label="Location"
          value={filters.county ?? ''}
          onChange={(e) => update({ county: e.target.value || undefined })}
          className={inputClass}
        >
          <option value="">All locations</option>
          {counties.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div
          role="group"
          aria-label="Price range in KES"
          className="flex items-center gap-2"
        >
          <span className="text-[10px] tracking-[0.2em] text-muted">KES</span>
          <PriceField
            key={`min-${filters.minPrice ?? ''}`}
            label="Minimum price"
            placeholder="Min"
            value={filters.minPrice}
            onCommit={(minPrice) => update({ minPrice })}
          />
          <span aria-hidden className="text-muted">
            —
          </span>
          <PriceField
            key={`max-${filters.maxPrice ?? ''}`}
            label="Maximum price"
            placeholder="Max"
            value={filters.maxPrice}
            onCommit={(maxPrice) => update({ maxPrice })}
          />
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md px-3 py-2 text-xs tracking-widest text-muted transition-colors hover:text-gold"
          >
            CLEAR
          </button>
        )}

        <p
          aria-live="polite"
          className="ml-auto text-xs tracking-widest text-muted"
        >
          {isPending ? 'UPDATING…' : `${total} LISTING${total === 1 ? '' : 'S'}`}
        </p>
      </div>
    </section>
  );
}

/**
 * Price inputs commit on blur or Enter, not per keystroke — one URL write
 * per decision keeps the back/forward history and the server round-trips
 * quiet. The parent keys the field by its committed value, so a change from
 * elsewhere (clear, back/forward) remounts it with the new draft.
 */
function PriceField({
  label,
  placeholder,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: number | undefined;
  readonly onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : '');

  function commit() {
    const raw = draft.trim().replace(/,/g, '');
    if (raw === '') {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(value != null ? String(value) : '');
      return;
    }
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
      }}
      className={`${inputClass} w-24`}
    />
  );
}
