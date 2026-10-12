/**
 * Homepage horizontal collection strip (server component).
 *
 * Takes verified published cards as props — the same read-model surface as
 * FeaturedProperties. With Phase 3 not yet run the demo rows have no
 * imagery, so each figure renders the honest media-pending state instead
 * of a stock photo; when media lands, imagery goes live in this one
 * component. Kenya-only, verified facts only.
 */

import { MapPin } from "lucide-react";
import Link from "next/link";
import { formatListingPrice } from "@/lib/marketplace/format-money";
import type { PublishedListingCard } from "@/lib/marketplace/read-model";

export default function PropertyShowcase({
  properties,
}: {
  readonly properties: readonly PublishedListingCard[];
}) {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24 lg:px-12">
      <div className="flex gap-6 overflow-x-auto pb-6 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]">
        <div className="w-[min(90vw,480px)] shrink-0">
          <h2 className="font-display text-5xl tracking-wide text-white md:text-6xl">
            THE COLLECTION
          </h2>
          <p className="mt-6 max-w-md text-muted">
            Kenya&rsquo;s most exceptional residences, one scroll at a time.
          </p>
        </div>

        {properties.map((property) => (
          <figure
            key={property.listingId}
            className="group relative h-[60vh] min-h-[28rem] w-[80vw] shrink-0 overflow-hidden border border-white/10 md:w-[60vw] lg:w-[44vw]"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-2 text-center">
              <span
                aria-hidden
                className="font-display text-5xl tracking-wide text-gold/40"
              >
                LUXONN
              </span>
              <span className="px-6 text-xs tracking-[0.2em] text-muted">
                IMAGERY PENDING
              </span>
            </div>
            <Link
              href={`/property/${property.listingId}`}
              className="absolute inset-0 z-10"
              aria-label={property.title}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            <figcaption className="absolute bottom-0 left-0 p-6">
              <p className="text-xs tracking-[0.2em] text-gold">
                {formatListingPrice(
                  property.priceAmount,
                  property.priceCurrency,
                  property.pricePeriod,
                )}
              </p>
              <p className="mt-1 font-display text-3xl tracking-wide text-white">
                {property.title}
              </p>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                <MapPin className="h-4 w-4 text-gold" aria-hidden />
                {[property.area, property.city, property.county]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
