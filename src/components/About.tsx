"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";

gsap.registerPlugin(ScrollTrigger);

const STATS = [
  { value: "25+", label: "Years of Expertise" },
  { value: "4B+", label: "In Sales Volume" },
  { value: "12", label: "Global Locations" },
];

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
      gsap.fromTo(
        "[data-about='stat']",
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: "[data-about='stats']", start: "top 85%" },
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

        <div className="flex flex-col gap-8">
          <h2 className="font-display text-5xl tracking-wide text-white md:text-6xl">
            ARCHITECTURAL MASTERPIECES
          </h2>
          <p className="text-lg leading-relaxed text-muted">
            LUXONN exists for one reason: to place extraordinary people inside
            extraordinary spaces. We travel the world to find residences that
            are not merely built, but composed — homes where light, material,
            and proportion work in concert.
          </p>
          <p className="text-lg leading-relaxed text-muted">
            Our advisors do not sell listings. They curate introductions
            between discerning buyers and the properties that deserve them,
            handling every negotiation with absolute discretion.
          </p>

          <div data-about="stats" className="mt-4 grid grid-cols-3 gap-6">
            {STATS.map((stat) => (
              <div key={stat.label} data-about="stat" className="flex flex-col gap-2">
                <p className="font-display text-4xl text-gold md:text-5xl">
                  {stat.value}
                </p>
                <p className="text-sm text-muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
