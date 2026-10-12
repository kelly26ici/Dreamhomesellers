/**
 * /property/[listingId] — the published listing detail page.
 *
 * Renders ONLY verified published facts from the read model. Under
 * cacheComponents the shell streams; the awaiting detail resolves inside
 * Suspense. Location is area-level by construction (ADR-014): public
 * revisions carry no address field, and the read model selects none.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import ListingMedia from '@/components/marketplace/ListingMedia';
import { fetchPublishedListing } from '@/lib/marketplace/read-model';

export const metadata = {
  title: 'Property — LUXONN',
};

export default async function PropertyPage(
  props: PageProps<'/property/[listingId]'>,
) {
  return (
    <main className="min-h-screen">
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={props.params} />
      </Suspense>
    </main>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading property" className="mx-auto max-w-5xl px-4 py-10">
      <div className="h-8 w-48 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 aspect-[16/9] animate-pulse rounded-xl bg-surface" />
      <div className="mt-6 h-6 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="mt-4 h-24 animate-pulse rounded bg-surface" />
    </div>
  );
}

async function Detail({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  const result = await fetchPublishedListing(listingId);
  if (!result) notFound();

  const { card, media } = result;

  const specs: ReadonlyArray<[string, string]> = [
    ['Type', card.propertyType],
    ['Bedrooms', card.bedrooms != null ? String(card.bedrooms) : '—'],
    ['Bathrooms', card.bathrooms != null ? String(card.bathrooms) : '—'],
    ['Interior', card.squareMeters != null ? `${card.squareMeters} m²` : '—'],
    ['Plot', card.lotSizeSqm != null ? `${card.lotSizeSqm} m²` : '—'],
    ['Furnished', card.furnished == null ? '—' : card.furnished ? 'Yes' : 'No'],
  ];

  return (
    <article className="mx-auto max-w-5xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="mb-6 text-xs tracking-widest text-muted">
        <Link href="/properties" className="hover:text-gold">
          ← BACK TO PROPERTIES
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] text-gold">
            {card.listingKind.toUpperCase()} · {card.availability.replace(/_/g, ' ').toUpperCase()}
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-wide text-white md:text-5xl">
            {card.title}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {[card.area, card.city, card.county, card.country].filter(Boolean).join(', ')}
          </p>
        </div>
        <p className="text-2xl font-medium text-champagne">
          {formatDetailPrice(card.priceAmount, card.priceCurrency, card.pricePeriod)}
        </p>
      </header>

      <div className="mt-8">
        <ListingMedia strip={media} title={card.title} />
      </div>

      <section aria-label="Key facts" className="mt-8">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {specs.map(([label, value]) => (
            <div key={label} className="glass rounded-lg p-3">
              <dt className="text-[10px] tracking-[0.2em] text-muted uppercase">{label}</dt>
              <dd className="mt-1 text-sm text-white capitalize">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {card.amenities.length > 0 && (
        <section aria-label="Amenities" className="mt-8">
          <h2 className="text-xs tracking-[0.2em] text-gold">AMENITIES</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {card.amenities.map((a) => (
              <li
                key={a}
                className="glass rounded-full px-3 py-1 text-xs text-white"
              >
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Description" className="mt-8">
        <h2 className="text-xs tracking-[0.2em] text-gold">ABOUT THIS PROPERTY</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/90">
          {card.description}
        </p>
      </section>

      <footer className="mt-10 border-t border-white/10 pt-6 text-xs text-muted">
        Published facts from the LUXONN verified record
        {card.publishedAt
          ? ` · listed ${new Date(card.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })}`
          : null}
        .
      </footer>
    </article>
  );
}

function formatDetailPrice(
  amount: string,
  currency: string,
  period: string,
): string {
  const value = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
  const suffix =
    period === 'per_month' ? ' /mo' : period === 'per_night' ? ' /night' : '';
  return `${value}${suffix}`;
}
