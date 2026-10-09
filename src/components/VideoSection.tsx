"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { Play } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

export default function VideoSection() {
  const rootRef = useRef<HTMLElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const play = playRef.current;
      if (play) {
        gsap.to(play, {
          scale: 1.08,
          duration: 1.2,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        });
      }
      gsap.fromTo(
        "[data-video='image-wrap']",
        { scale: 1, borderRadius: "0rem" },
        {
          scale: 0.92,
          borderRadius: "2rem",
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "top center",
            end: "center center",
            scrub: true,
          },
        }
      );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={rootRef} className="px-6 py-24 lg:px-12">
      <div
        data-video="image-wrap"
        className="relative mx-auto flex h-[90vh] max-w-[1440px] items-center justify-center overflow-hidden"
      >
        <Image
          src="https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=2400&q=80"
          alt="Luxury residence exterior at dusk with lit pool"
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <button
          ref={playRef}
          type="button"
          aria-label="Play the LUXONN film"
          className="relative z-10 flex h-28 w-28 items-center justify-center rounded-full border border-gold/50 bg-black/40 text-gold backdrop-blur-md transition-colors hover:border-gold hover:bg-gold/20"
        >
          <Play className="h-10 w-10 fill-gold" aria-hidden />
        </button>
      </div>
    </section>
  );
}
