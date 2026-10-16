/**
 * /properties — the buyer discovery grid (ADR-006).
 *
 * The URL is the search state: filters, sort, and page all live in
 * searchParams, parsed by url-state and executed by the read model. Under
 * cacheComponents the shell (header, filter-bar layout frame) prerenders
 * and the awaiting results stream inside Suspense — the canonical Next 16
 * pattern from the installed caching guide.
 *
 * This page never touches draft data: the query root is `listings` with
 * lifecycle_state='published', and RLS + column grants make the anonymous
 * buyer surface the only path here by construction.
 */

import { Suspense } from 'react';
import Link from 'next/link';

import FilterBar from '@/components/marketplace/FilterBar';
import ListingCard from '@/components/marketplace/ListingCard';
import {
  fetchPublishedCounties,
  fetchPublishedTypes,
  fetchPublishedGrid,
} from '@/lib/marketplace/read-model';
import {
  buildListingUrl,
  parseListingFilters,
} from '@/lib/marketplace/url-state';

export const metadata = {
  title: 'Properties — LUXONN',
  description:
    'Browse verified premium properties across Kenya — Nairobi, Mombasa, Nakuru and beyond.',
};

// The shell reads searchParams to derive its kind heading, and the layout's
// SimonProvider holds a useSearchParams() sync hook. Under cacheComponents a
// static prerender of that pair is a blocking-prerender error, so this route
// opts out — matching src/app/simon/page.tsx. The grid itself still streams
// inside Suspense, so nothing about the data path became slower.
export const instant = false;

const KIND_LABELS: Record<string, string> = {
  sale: 'For Sale',
  rent: 'For Rent',
  shortlet: 'Shortlet',
};

export default async function PropertiesPage(
  props: PageProps<'/properties'>,
) {
  const params = await props.searchParams;
  const filters = parseListingFilters(params);

  // Derive display label from URL kind param (ADR-006: URL is search state).
  const activeKinds = filters.kinds ?? [];
  const kindLabel =
    activeKinds.length === 0
      ? 'All Properties'
      : activeKinds.length === 1
        ? KIND_LABELS[activeKinds[0]] ?? 'Properties'
        : `${activeKinds.length} Collections`;

  return (
    <main className="min-h-screen">
      {/* Static shell: renders instantly, even before data resolves. */}
      <header className="border-b border-white/10 bg-black/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4 py-10">
          <div>
            <p className="text-xs tracking-[0.2em] text-gold">
              THE COLLECTION
            </p>
            <h1 className="mt-2 font-display text-5xl tracking-wide text-white md:text-6xl">
              {kindLabel}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-muted">
              Verified premium listings across Kenya. Every price, every fact,
              straight from the published record.
            </p>
          </div>
          <Link
            href="/saved"
            className="glass rounded-md px-4 py-2 text-xs tracking-widest text-gold transition-colors hover:border-gold/50 hover:text-white"
          >
            SAVED →
          </Link>
        </div>
      </header>

      <Suspense fallback={<GridSkeleton />}>
        <Results filters={filters} />
      </Suspense>
    </main>
  );
}

/** Layout-stable loading state matching the real grid's footprint. */
function GridSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading listings">
      <div className="h-[60px] border-b border-white/10 bg-black/20" />
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-80 animate-pulse rounded-lg border border-white/10 bg-surface"
          />
        ))}
      </div>
    </div>
  );
}

async function Results({
  filters,
}: {
  filters: ReturnType<typeof parseListingFilters>;
}) {
  const [grid, counties, types] = await Promise.all([
    fetchPublishedGrid(filters),
    fetchPublishedCounties(),
    fetchPublishedTypes(),
  ]);

  return (
    <>
      {/* Promoted count: visible at top of viewport so BUY vs RENT counts are legible at a glance */}
      <div className="border-b border-white/10 px-4 py-3">
        <p
          aria-live="polite"
          className="mx-auto max-w-7xl text-xs uppercase tracking-[0.2em] text-gold"
        >
          {grid.total} LISTING{grid.total === 1 ? '' : 'S'} AVAILABLE
        </p>
      </div>

      <FilterBar
        filters={filters}
        counties={counties}
        types={types}
        total={grid.total}
      />

      {grid.cards.length === 0 ? (
        <EmptyState filtered={hasAnyFilter(filters)} />
      ) : (
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {grid.cards.map((card) => (
              <ListingCard
                key={card.listingId}
                card={card}
                media={grid.mediaByRevision.get(card.revisionId)}
              />
            ))}
          </div>
          <Pagination
            page={grid.page}
            pageCount={grid.pageCount}
            filters={filters}
          />
        </div>
      )}
    </>
  );
}

function hasAnyFilter(f: ReturnType<typeof parseListingFilters>): boolean {
  return Boolean(
    f.q || f.kinds?.length || f.county || f.type ||
      f.minBedrooms != null || f.minPrice != null || f.maxPrice != null,
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center">
      <span aria-hidden className="font-display text-7xl tracking-wide text-gold/30">
        LUXONN
      </span>
      <h2 className="mt-6 font-display text-3xl tracking-wide text-white">
        {filtered ? 'Nothing matches this search' : 'The collection is being curated'}
      </h2>
      <p className="mt-3 max-w-md text-sm text-muted">
        {filtered
          ? 'Adjust or clear the filters — the collection is small and growing.'
          : 'Published listings will appear here as owners complete verification.'}
      </p>
      {filtered && (
        <Link
          href="/properties"
          className="mt-8 rounded-md border border-gold/60 px-5 py-2 text-sm tracking-widest text-gold transition-colors hover:bg-gold hover:text-black"
        >
          CLEAR FILTERS
        </Link>
      )}
    </div>
  );
}

/**
 * URL-backed pagination: plain links, works without JS, each page is its
 * own shareable URL per ADR-006.
 */
function Pagination({
  page,
  pageCount,
  filters,
}: {
  page: number;
  pageCount: number;
  filters: ReturnType<typeof parseListingFilters>;
}) {
  if (pageCount <= 1) return null;

  const linkClass =
    'glass rounded-md px-4 py-2 text-sm text-white transition-colors ' +
    'hover:border-gold/50 hover:text-gold';

  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-3">
      {page > 1 && (
        <Link
          href={buildListingUrl({ ...filters, page: page - 1 })}
          className={linkClass}
          aria-label="Previous page"
        >
          ← Prev
        </Link>
      )}
      <span className="text-xs tracking-widest text-muted">
        PAGE {page} OF {pageCount}
      </span>
      {page < pageCount && (
        <Link
          href={buildListingUrl({ ...filters, page: page + 1 })}
          className={linkClass}
          aria-label="Next page"
        >
          Next →
        </Link>
      )}
    </nav>
  );
}
