"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { Star } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const TESTIMONIALS = [
  {
    quote:
      "They found us a penthouse we didn't know existed and negotiated terms we didn't think possible. Absolute discretion from start to finish.",
    name: "Amara Okafor",
    role: "Private Client, Dubai",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80",
  },
  {
    quote:
      "Every property they presented was worth the flight. When you work with LUXONN you stop browsing listings and start choosing between masterpieces.",
    name: "Daniel Roth",
    role: "Collector, New York",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80",
  },
];

export default function Testimonials() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-testimonials='card']",
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 80%" },
        }
      );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative mx-auto max-w-[1440px] overflow-hidden px-6 py-32 lg:px-12"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 select-none font-display text-[24rem] leading-none text-gold/5"
      >
        &ldquo;
      </span>

      <div className="relative grid gap-8 md:grid-cols-2">
        {TESTIMONIALS.map((t) => (
          <figure
            key={t.name}
            data-testimonials="card"
            className="flex flex-col gap-6 border border-white/10 bg-surface/60 p-10"
          >
            <div className="flex gap-1" aria-label="5 out of 5 stars">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-gold text-gold" aria-hidden />
              ))}
            </div>
            <blockquote className="text-lg leading-relaxed text-white/90">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-auto flex items-center gap-4">
              <Image
                src={t.avatar}
                alt={`Portrait of ${t.name}`}
                width={48}
                height={48}
                className="h-12 w-12 rounded-full object-cover"
              />
              <div>
                <p className="text-sm font-medium text-white">{t.name}</p>
                <p className="text-xs text-muted">{t.role}</p>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
