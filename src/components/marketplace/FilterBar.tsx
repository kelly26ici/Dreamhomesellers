'use client';

/**
 * Buyer grid filter bar (client island).
 *
 * Owns the URL write side of ADR-006: every control change serializes the
 * new state with buildListingUrl and pushes it with router.replace — no
 * history spam, the URL is always shareable. It receives current state as
 * props (parsed server-side by the page) and re-renders from props, so the
 * component stays dumb and the server stays the source of truth.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { ListingKind } from '@/lib/contracts/listing';
import { buildListingUrl } from '@/lib/marketplace/url-state';
import type { ListingFilters, ListingSort } from '@/lib/marketplace/read-model';

const KIND_OPTIONS: ReadonlyArray<{ value: ListingKind; label: string }> = [
  { value: 'sale', label: 'For Sale' },
  { value: 'rent', label: 'For Rent' },
  { value: 'shortlet', label: 'Shortlet' },
];

const SORT_OPTIONS: ReadonlyArray<{ value: ListingSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price ↑' },
  { value: 'price-desc', label: 'Price ↓' },
  { value: 'bedrooms-desc', label: 'Beds ↓' },
];

const BED_OPTIONS = [1, 2, 3, 4, 5] as const;

export interface FilterBarProps {
  readonly filters: ListingFilters;
  readonly counties: readonly string[];
  readonly types: readonly string[];
  /** Total matched listings, for the result line. */
  readonly total: number;
}

export default function FilterBar({
  filters,
  counties,
  types,
  total,
}: FilterBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function update(patch: Partial<ListingFilters>) {
    const next: ListingFilters = { ...filters, ...patch, page: 1 };
    startTransition(() => {
      router.replace(buildListingUrl(next), { scroll: false });
    });
  }

  const inputClass =
    'glass rounded-md px-3 py-2 text-sm text-white placeholder:text-muted ' +
    'outline-none focus:ring-1 focus:ring-gold';

  return (
    <section
      aria-label="Search filters"
      className="border-b border-white/10 bg-black/30 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
        <input
          type="search"
          aria-label="Search by title"
          placeholder="Search listings…"
          defaultValue={filters.q ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              update({ q: (e.target as HTMLInputElement).value });
            }
          }}
          onBlur={(e) => {
            if (e.target.value.trim() !== (filters.q ?? '')) {
              update({ q: e.target.value });
            }
          }}
          className={`${inputClass} min-w-52 flex-1`}
        />

        <div role="group" aria-label="Offer kind" className="flex gap-1">
          {KIND_OPTIONS.map(({ value, label }) => {
            const active = filters.kinds?.includes(value) ?? false;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const set = new Set(filters.kinds ?? []);
                  if (active) set.delete(value);
                  else set.add(value);
                  update({ kinds: set.size ? [...set] : undefined });
                }}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-gold text-black'
                    : 'glass text-white hover:text-gold'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <select
          aria-label="County"
          value={filters.county ?? ''}
          onChange={(e) => update({ county: e.target.value || undefined })}
          className={inputClass}
        >
          <option value="">All counties</option>
          {counties.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          aria-label="Property type"
          value={filters.type ?? ''}
          onChange={(e) => update({ type: e.target.value || undefined })}
          className={inputClass}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          aria-label="Minimum bedrooms"
          value={filters.minBedrooms != null ? String(filters.minBedrooms) : ''}
          onChange={(e) =>
            update({
              minBedrooms: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          className={inputClass}
        >
          <option value="">Beds: any</option>
          {BED_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}+
            </option>
          ))}
        </select>

        <select
          aria-label="Sort order"
          value={filters.sort}
          onChange={(e) => update({ sort: e.target.value as ListingSort })}
          className={inputClass}
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

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
