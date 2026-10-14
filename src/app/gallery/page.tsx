/**
 * /gallery — Curated Signature Collection 3D circular experience (ADR-007).
 *
 * Constrained strictly to a small curated set of verified published Kenyan
 * residences from the canonical database read model. Never broad search.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { CircularGallery, type ResidenceGalleryItem } from '@/components/circular-gallery';
import { fetchPublishedFeatured } from '@/lib/marketplace/read-model';
import { formatListingPrice } from '@/lib/marketplace/format-money';

export const metadata = {
  title: 'Curated 3D Gallery — LUXONN',
  description:
    'Interactive 3D circular presentation of Kenya’s pre-eminent architectural residences.',
};

export default function GalleryPage() {
  return (
    <main className="relative h-screen w-full overflow-hidden bg-background">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(212,175,55,0.06)_0%,transparent_70%)]" />

      {/* Top Header */}
      <header className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-6 py-6 lg:px-12">
        <Link
          href="/properties"
          className="flex items-center gap-2 text-xs tracking-[0.2em] text-muted transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4" />
          BACK TO PROPERTIES
        </Link>
        <span className="font-display text-xl tracking-[0.2em] text-gold">
          LUXONN ARCHIVE
        </span>
      </header>

      {/* Title & Instructions Banner */}
      <div className="pointer-events-none absolute left-0 right-0 top-20 z-10 text-center">
        <p className="text-[10px] tracking-[0.3em] text-gold uppercase">
          CURATED SIGNATURE COLLECTION
        </p>
        <h1 className="mt-1 font-display text-4xl tracking-wider text-foreground sm:text-5xl">
          Architectural Sanctuaries
        </h1>
        <p className="mt-2 text-xs text-muted">
          Drag horizontally or let idle to rotate through Kenya’s landmark estates.
        </p>
      </div>

      <Suspense fallback={<GallerySkeleton />}>
        <CuratedGalleryLoader />
      </Suspense>

      {/* Bottom Hint */}
      <footer className="pointer-events-none absolute bottom-6 left-0 right-0 z-10 text-center text-[10px] tracking-widest text-muted">
        VERIFIED POSTGRES RESIDENCES · INTERACTIVE 3D PERSPECTIVE
      </footer>
    </main>
  );
}

function GallerySkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-gold/40 border-t-gold" />
        <p className="text-xs tracking-widest text-gold">LOADING CURATED COLLECTION...</p>
      </div>
    </div>
  );
}

async function CuratedGalleryLoader() {
  const publishedListings = await fetchPublishedFeatured(8);

  const items: ResidenceGalleryItem[] = publishedListings.map((card) => {
    const loc = [card.area, card.city, card.country].filter(Boolean).join(', ');
    const priceFormatted = formatListingPrice(
      card.priceAmount,
      card.priceCurrency,
      card.pricePeriod
    );

    return {
      id: card.listingId,
      title: card.title,
      propertyType: card.propertyType,
      location: loc,
      priceFormatted,
      href: `/property/${card.listingId}`,
      imageUrl: null, // Resolves via branded fallback or derivatives
    };
  });

  return (
    <div className="h-full w-full pt-16">
      <CircularGallery items={items} radius={580} autoRotateSpeed={0.035} />
    </div>
  );
}
