"use client";

/**
 * Homepage featured-properties section (client island for GSAP reveal).
 *
 * Data comes from the server via props — the page awaits
 * fetchPublishedFeatured() and hands down verified published cards. With
 * Phase 3 not yet run the demo rows have no imagery, so each card renders
 * the honest media-pending state instead of a stock photo; when media
 * lands, imagery goes live in this one component.
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MapPin } from "lucide-react";
import Link from "next/link";
import { formatListingPrice } from "@/lib/marketplace/format-money";
import type { PublishedListingCard } from "@/lib/marketplace/read-model";

gsap.registerPlugin(ScrollTrigger);

export default function FeaturedProperties({
  properties,
}: {
  readonly properties: readonly PublishedListingCard[];
}) {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-featured='card']",
        { y: 80, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: root,
            start: "top 80%",
          },
        }
      );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      id="properties"
      className="mx-auto max-w-[1440px] px-6 py-32 lg:px-12"
    >
      <div className="mb-16 flex flex-col gap-4">
        <h2 className="font-display text-5xl tracking-wide text-white md:text-6xl">
          FEATURED PROPERTIES
        </h2>
        <p className="max-w-2xl text-muted">
          The latest verified additions to the Kenyan collection. Each
          listing is published from the LUXONN record — price and facts
          exactly as verified.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        {properties.map((property) => (
          <article
            key={property.listingId}
            data-featured="card"
            className="group relative h-[520px] overflow-hidden border border-white/10 transition-colors duration-500 hover:border-gold/60"
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
            <div className="absolute inset-x-0 bottom-0 translate-y-6 bg-gradient-to-t from-black/90 to-transparent p-6 pt-16 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
              <p className="text-xs tracking-[0.2em] text-gold">
                {formatListingPrice(
                  property.priceAmount,
                  property.priceCurrency,
                  property.pricePeriod,
                )}
              </p>
              <h3 className="mt-1 font-display text-2xl tracking-wide text-white">
                {property.title}
              </h3>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <MapPin className="h-4 w-4 text-gold" aria-hidden />
                {[property.area, property.city, property.county]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
