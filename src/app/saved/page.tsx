'use client';

/**
 * /saved — the anonymous buyer's saved listings and compare table.
 *
 * This page is a client island end to end: the saved/compare state lives
 * in the viewer's browser (localStorage, see saved-listings.ts), so no
 * server render can know it. Facts are NOT stored — every mount re-fetches
 * the saved IDs through fetchPublishedListingsByIds, which is RLS-governed
 * and published-only. A listing that was unpublished, moderated, or
 * deleted simply stops appearing; the store's stale ID is ignored until
 * the viewer removes it or it resolves again.
 *
 * The compare table is a second view over the same saved set: at most
 * COMPARE_LIMIT columns, one attribute row each, drawn from the same
 * fetched cards. No separate query, no second authority.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';

import {
  compareStore,
  savedStore,
  COMPARE_LIMIT,
} from '@/lib/marketplace/saved-listings';
import {
  fetchPublishedListingsByIds,
  type PublishedListingCard,
} from '@/lib/marketplace/read-model';

function useStoreIds(store: typeof savedStore): readonly string[] {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

function formatPrice(card: PublishedListingCard): string {
  const value = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: card.priceCurrency,
    maximumFractionDigits: 0,
  }).format(Number(card.priceAmount));
  const suffix =
    card.pricePeriod === 'per_month'
      ? ' /mo'
      : card.pricePeriod === 'per_night'
        ? ' /night'
        : '';
  return `${value}${suffix}`;
}

const ROWS: ReadonlyArray<{
  label: string;
  render: (card: PublishedListingCard) => string;
}> = [
  { label: 'Price', render: (c) => formatPrice(c) },
  { label: 'Kind', render: (c) => c.listingKind },
  { label: 'Type', render: (c) => c.propertyType },
  {
    label: 'Location',
    render: (c) => [c.area, c.city, c.county].filter(Boolean).join(', '),
  },
  {
    label: 'Bedrooms',
    render: (c) => (c.bedrooms != null ? String(c.bedrooms) : '—'),
  },
  {
    label: 'Bathrooms',
    render: (c) => (c.bathrooms != null ? String(c.bathrooms) : '—'),
  },
  {
    label: 'Interior',
    render: (c) => (c.squareMeters != null ? `${c.squareMeters} m²` : '—'),
  },
  {
    label: 'Plot',
    render: (c) => (c.lotSizeSqm != null ? `${c.lotSizeSqm} m²` : '—'),
  },
  {
    label: 'Furnished',
    render: (c) => (c.furnished == null ? '—' : c.furnished ? 'Yes' : 'No'),
  },
  { label: 'Availability', render: (c) => c.availability },
];

export default function SavedPage() {
  const savedIds = useStoreIds(savedStore);
  const compareIds = useStoreIds(compareStore);

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cards, setCards] = useState<readonly PublishedListingCard[]>([]);

  // Re-fetch whenever the saved set changes (this tab or another tab —
  // the storage event re-renders through the store subscription). The
  // empty-set case never enters the effect: it is derived in render below
  // (savedIds.length === 0 → empty list, ready phase), which is why this
  // effect only ever calls setState inside async callbacks.
  useEffect(() => {
    if (savedIds.length === 0) return;
    let cancelled = false;
    fetchPublishedListingsByIds(savedIds)
      .then((result) => {
        if (!cancelled) {
          setCards(result.cards);
          setPhase('ready');
          setErrorMessage(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Fetch failed');
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [savedIds]);

  // Compare columns follow the compare store's order, restricted to what
  // actually resolved as published+visible (stale compare ids drop out).
  const compareCards = useMemo(() => {
    const byId = new Map(cards.map((c) => [c.listingId, c]));
    return compareIds
      .map((id) => byId.get(id))
      .filter((c): c is PublishedListingCard => c !== undefined);
  }, [cards, compareIds]);

  const staleCount = savedIds.length - cards.length;

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/10 bg-black/40">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <p className="text-xs tracking-[0.2em] text-gold">YOUR SHORTLIST</p>
          <h1 className="mt-2 font-display text-5xl tracking-wide text-white md:text-6xl">
            Saved
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Listings you saved while browsing. Saved on this device — facts
            always read live from the published record.
          </p>
        </div>
      </header>

      {phase === 'error' && (
        <div className="mx-auto max-w-7xl px-4 py-16 text-center">
          <h2 className="font-display text-3xl tracking-wide text-white">
            Could not load your saved listings
          </h2>
          <p className="mt-3 text-sm text-muted">{errorMessage}</p>
        </div>
      )}

      {/* No fetch is needed to know the list is empty, so this shows
          immediately regardless of phase — including on the server pass. */}
      {savedIds.length === 0 && (
        <div className="mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center">
          <span
            aria-hidden
            className="font-display text-7xl tracking-wide text-gold/30"
          >
            LUXONN
          </span>
          <h2 className="mt-6 font-display text-3xl tracking-wide text-white">
            Nothing saved yet
          </h2>
          <p className="mt-3 max-w-md text-sm text-muted">
            Save listings from the grid or a property page and they will
            collect here for comparison.
          </p>
          <Link
            href="/properties"
            className="mt-8 rounded-md border border-gold/60 px-5 py-2 text-sm tracking-widest text-gold transition-colors hover:bg-gold hover:text-black"
          >
            BROWSE PROPERTIES
          </Link>
        </div>
      )}

      {savedIds.length > 0 && (
        <div className="mx-auto max-w-7xl px-4 py-8">
          {staleCount > 0 && (
            <p
              className="mb-6 text-xs tracking-widest text-muted"
              role="status"
            >
              {staleCount} saved{' '}
              {staleCount === 1 ? 'listing is' : 'listings are'} no longer in
              the published record and will not show here.
            </p>
          )}

          {/* Saved list */}
          <section aria-label="Saved listings" className="space-y-3">
            {cards.map((card) => {
              const inCompare = compareIds.includes(card.listingId);
              return (
                <div
                  key={card.listingId}
                  className="flex flex-col gap-3 rounded-lg border border-white/10 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <Link
                      href={`/property/${card.listingId}`}
                      className="font-display text-xl tracking-wide text-white hover:text-gold"
                    >
                      {card.title}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {formatPrice(card)} ·{' '}
                      {[card.area, card.city, card.county]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={inCompare}
                      className={
                        inCompare
                          ? 'rounded-md border border-gold bg-gold px-3 py-1.5 text-xs tracking-widest text-black'
                          : 'rounded-md border border-gold/60 px-3 py-1.5 text-xs tracking-widest text-gold transition-colors hover:bg-gold hover:text-black'
                      }
                      onClick={() => compareStore.toggle(card.listingId)}
                    >
                      {inCompare ? 'COMPARING ✓' : 'COMPARE'}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-white/20 px-3 py-1.5 text-xs tracking-widest text-muted transition-colors hover:border-white/50 hover:text-white"
                      onClick={() => savedStore.toggle(card.listingId)}
                    >
                      REMOVE
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Compare table */}
          <section aria-label="Comparison" className="mt-12">
            <h2 className="font-display text-3xl tracking-wide text-white">
              Compare
            </h2>
            <p className="mt-2 text-sm text-muted">
              Up to {COMPARE_LIMIT} saved listings side by side.{' '}
              {compareCards.length}/{COMPARE_LIMIT} selected.
            </p>

            {compareCards.length === 0 ? (
              <p className="mt-6 text-sm text-muted">
                Pick listings from your saved list above to compare them here.
              </p>
            ) : (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="w-32 border-b border-white/10 p-3 text-left text-xs tracking-widest text-muted"
                      >
                        ATTRIBUTE
                      </th>
                      {compareCards.map((card) => (
                        <th
                          key={card.listingId}
                          scope="col"
                          className="border-b border-white/10 p-3 text-left"
                        >
                          <Link
                            href={`/property/${card.listingId}`}
                            className="font-display text-lg tracking-wide text-white hover:text-gold"
                          >
                            {card.title}
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={row.label}>
                        <th
                          scope="row"
                          className="border-b border-white/5 p-3 text-left text-xs tracking-widest text-muted"
                        >
                          {row.label.toUpperCase()}
                        </th>
                        {compareCards.map((card) => (
                          <td
                            key={card.listingId}
                            className="border-b border-white/5 p-3 text-white"
                          >
                            {row.render(card)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {phase === 'loading' && savedIds.length > 0 && (
        <div
          aria-busy="true"
          aria-label="Loading saved listings"
          className="mx-auto max-w-7xl px-4 py-16"
        >
          <div className="h-40 animate-pulse rounded-lg border border-white/10 bg-surface" />
        </div>
      )}
    </main>
  );
}
