"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";

gsap.registerPlugin(ScrollTrigger);

export default function About() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-about='image']",
        { yPercent: -8 },
        {
          yPercent: 8,
          ease: "none",
          scrollTrigger: {
            trigger: "[data-about='image-wrap']",
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        }
      );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      id="about"
      className="mx-auto max-w-[1440px] px-6 py-32 lg:px-12"
    >
      <div className="grid items-center gap-16 lg:grid-cols-2">
        <div data-about="image-wrap" className="relative aspect-[4/5] overflow-hidden">
          <div data-about="image" className="absolute inset-[-8%]">
            <Image
              src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80"
              alt="Modern luxury residence with glass walls at dusk"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="font-display text-5xl tracking-wide text-white md:text-6xl">
            ARCHITECTURAL MASTERPIECES
          </h2>
          <p className="text-lg leading-relaxed text-muted">
            LUXONN was built around a straightforward conviction: exceptional architecture deserves a quiet, honest marketplace. We bring together Kenya’s landmark residences—from secluded Karen estates to contemporary high-rise penthouses in Westlands—directly from the owners who built and care for them.
          </p>
          <p className="text-lg leading-relaxed text-muted">
            Every price, specification, and detail is verified straight from the source. Whether you are listing a family residence or seeking your next sanctuary, the process is direct, transparent, and handled with complete discretion.
          </p>
        </div>
      </div>
    </section>
  );
}
