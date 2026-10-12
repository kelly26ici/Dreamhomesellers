/**
 * LUXONN homepage. Static shell (hero, about, services, contact) streams
 * immediately; the two merchandising rails await the published read model
 * inside their own Suspense boundaries — the same cacheComponents pattern
 * as /properties and /property/[listingId].
 */

import { Suspense } from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FeaturedProperties from "@/components/FeaturedProperties";
import About from "@/components/About";
import PropertyShowcase from "@/components/PropertyShowcase";
import Services from "@/components/Services";
import TestimonialsV2 from "@/components/testimonials-v2/TestimonialsV2";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";
import SimonLauncher from "@/components/SimonLauncher";
import { fetchPublishedFeatured } from "@/lib/marketplace/read-model";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Suspense fallback={<RailSkeleton variant="grid" />}>
          <FeaturedRail />
        </Suspense>
        <About />
        <Suspense fallback={<RailSkeleton variant="strip" />}>
          <ShowcaseRail />
        </Suspense>
        <Services />
        <TestimonialsV2 />
        <Contact />
      </main>
      <SimonLauncher />
      <Footer />
    </>
  );
}

/** Latest three published listings for the featured grid. */
async function FeaturedRail() {
  const properties = await fetchPublishedFeatured(3);
  return <FeaturedProperties properties={properties} />;
}

/** Newest five published listings for the collection strip. */
async function ShowcaseRail() {
  const properties = await fetchPublishedFeatured(5);
  return <PropertyShowcase properties={properties} />;
}

function RailSkeleton({ variant }: { variant: "grid" | "strip" }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading properties"
      className={
        variant === "grid"
          ? "mx-auto grid max-w-[1440px] gap-8 px-6 py-32 md:grid-cols-3 lg:px-12"
          : "flex gap-6 overflow-hidden px-6 py-24 lg:px-12"
      }
    >
      {Array.from({ length: variant === "grid" ? 3 : 4 }, (_, i) => (
        <div
          key={i}
          className={
            variant === "grid"
              ? "h-[520px] animate-pulse bg-surface"
              : "h-[28rem] w-[60vw] shrink-0 animate-pulse bg-surface"
          }
        />
      ))}
    </div>
  );
}
