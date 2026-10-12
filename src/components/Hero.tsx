"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { MapPin, Tag, Ruler } from "lucide-react";

// Facts mirror the verified published record (demo listing b01: the Karen
// villa) — real LUXONN numbers, not invented ones. The hero is decorative;
// wiring these live is future work once the media pipeline lands.
const FLOATING_CARDS = [
  { icon: MapPin, label: "Location", value: "Karen, Nairobi" },
  { icon: Tag, label: "Price", value: "Ksh 145,000,000" },
  { icon: Ruler, label: "Interior", value: "620 m²" },
];

export default function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnded = () => {
      video.pause();
      setTimeout(() => {
        video.play().catch(() => {});
      }, 5000);
    };
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.fromTo(
        "[data-hero='title-line']",
        { yPercent: 120, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 1.2, stagger: 0.15 }
      )
        .fromTo(
          "[data-hero='subtext']",
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 1 },
          "-=0.6"
        )
        .fromTo(
          "[data-hero='cta']",
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 1, stagger: 0.12 },
          "-=0.7"
        )
        .fromTo(
          "[data-hero='card']",
          { x: 60, opacity: 0 },
          { x: 0, opacity: 1, duration: 1, stagger: 0.15 },
          "-=0.7"
        );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      id="home"
      className="relative flex h-screen min-h-[640px] w-full overflow-hidden"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        poster="https://strvid.nyc3.cdn.digitaloceanspaces.com/motionsite/luxonn_hero_bg%20_img.png"
      >
        <source
          src="https://strvid.nyc3.cdn.digitaloceanspaces.com/motionsite/hero_bg_video_real_estate.mp4"
          type="video/mp4"
        />
      </video>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/90 to-transparent" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 items-center px-6 pt-24 lg:px-12">
        <div className="flex flex-col gap-8 lg:max-w-[55%]">
          <h1 className="font-display text-[clamp(4rem,10vw,9rem)] leading-[0.95] tracking-wide text-white">
            <span className="block overflow-hidden" data-hero="title-line">
              LUXURY
            </span>
            <span className="block overflow-hidden" data-hero="title-line">
              REDEFINED
            </span>
          </h1>

          <p data-hero="subtext" className="max-w-xl text-lg text-muted">
            Where architectural mastery meets quiet privilege. A private
            collection of Kenya&rsquo;s most exceptional residences,
            curated for those who accept nothing less.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row">
            <a
              data-hero="cta"
              href="/properties"
              className="border border-gold bg-gold px-8 py-4 text-sm tracking-[0.15em] text-black transition-all duration-300 hover:shadow-[0_0_40px_rgba(212,169,95,0.5)]"
            >
              Explore the Collection
            </a>
            <a
              data-hero="cta"
              href="#contact"
              className="border border-white/30 px-8 py-4 text-sm tracking-[0.15em] text-white transition-all duration-300 hover:border-white hover:bg-white/5"
            >
              Book a Private Viewing
            </a>
          </div>
        </div>

        <div className="ml-auto hidden flex-col gap-4 lg:flex">
          {FLOATING_CARDS.map((card) => (
            <div
              key={card.label}
              data-hero="card"
              className="glass flex w-64 items-center gap-4 p-4"
            >
              <card.icon className="h-6 w-6 shrink-0 text-gold" aria-hidden />
              <div>
                <p className="text-xs tracking-[0.2em] text-muted">
                  {card.label}
                </p>
                <p className="text-sm font-medium text-white">{card.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
