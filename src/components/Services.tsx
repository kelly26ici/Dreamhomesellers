"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Search, Home, TrendingUp, Paintbrush } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const SERVICES = [
  {
    icon: Search,
    title: "Property Buying",
    text: "Off-market access and private previews of residences matched to your brief, with every negotiation handled for you.",
  },
  {
    icon: Home,
    title: "Property Selling",
    text: "Presentation, photography, and placement that position your residence to the right buyers — quietly and globally.",
  },
  {
    icon: TrendingUp,
    title: "Investment Advisory",
    text: "Portfolio guidance across gateway cities, grounded in local data and long-term value rather than momentum.",
  },
  {
    icon: Paintbrush,
    title: "Interior Design",
    text: "Curated interiors that honor a property's architecture, from single-room refreshes to complete commissions.",
  },
];

export default function Services() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-services='card']",
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        }
      );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      id="services"
      className="mx-auto max-w-[1440px] px-6 py-32 lg:px-12"
    >
      <div className="mb-16 flex flex-col gap-4">
        <h2 className="font-display text-5xl tracking-wide text-white md:text-6xl">
          WHAT WE DO
        </h2>
        <p className="max-w-2xl text-muted">
          Four disciplines, one standard. Everything we take on is handled
          end-to-end by a single dedicated advisor.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICES.map((service) => (
          <article
            key={service.title}
            data-services="card"
            className="group relative overflow-hidden border border-white/10 bg-surface p-8 transition-colors duration-500 hover:border-gold/40"
          >
            <div className="pointer-events-none absolute -inset-20 opacity-0 transition-opacity duration-700 group-hover:opacity-100">
              <div className="absolute left-1/2 top-0 h-40 w-40 -translate-x-1/2 rounded-full bg-gold/20 blur-[80px]" />
            </div>
            <div className="absolute inset-x-0 top-0 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
            <service.icon
              className="h-8 w-8 text-gold transition-transform duration-500 group-hover:-translate-y-1 group-hover:scale-110"
              aria-hidden
            />
            <h3 className="mt-6 font-display text-2xl tracking-wide text-white">
              {service.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {service.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
