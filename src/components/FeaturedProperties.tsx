"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { MapPin } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const PROPERTIES = [
  {
    title: "Skyline Penthouse",
    location: "Dubai, UAE",
    price: "$14.2M",
    image:
      "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Fifth Avenue Duplex",
    location: "New York, USA",
    price: "$22.5M",
    image:
      "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Oceanfront Villa",
    location: "Miami, USA",
    price: "$18.7M",
    image:
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80",
  },
];

export default function FeaturedProperties() {
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
          Three addresses that define their skylines. Each residence is
          privately presented to pre-qualified clients.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        {PROPERTIES.map((property) => (
          <article
            key={property.title}
            data-featured="card"
            className="group relative h-[520px] overflow-hidden border border-white/10 transition-colors duration-500 hover:border-gold/60"
          >
            <Image
              src={property.image}
              alt={`${property.title}, ${property.location}`}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 translate-y-6 p-6 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
              <p className="text-xs tracking-[0.2em] text-gold">
                {property.price}
              </p>
              <h3 className="mt-1 font-display text-2xl tracking-wide text-white">
                {property.title}
              </h3>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <MapPin className="h-4 w-4 text-gold" aria-hidden />
                {property.location}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
