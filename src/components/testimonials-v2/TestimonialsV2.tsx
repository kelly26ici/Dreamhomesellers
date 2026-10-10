"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Canvas } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { Quote } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const TESTIMONIALS_ROW_1 = [
  {
    quote:
      "They found us a penthouse we didn't know existed and negotiated terms we didn't think possible. Absolute discretion from start to finish.",
    name: "Amara Okafor",
    role: "Private Client, Dubai",
    avatar: "https://i.pravatar.cc/150?img=47",
  },
  {
    quote:
      "Every property they presented was worth the flight. You stop browsing listings and start choosing between masterpieces.",
    name: "Daniel Roth",
    role: "Collector, New York",
    avatar: "https://i.pravatar.cc/150?img=12",
  },
  {
    quote:
      "The off-market access alone justified the retainer. Our villa in Cap Ferrat never touched a public listing.",
    name: "Isabelle Marchand",
    role: "Villa Owner, Côte d'Azur",
    avatar: "https://i.pravatar.cc/150?img=32",
  },
  {
    quote:
      "Twelve acquisitions across three gateway cities, each one sourced, vetted and closed inside a month.",
    name: "Khalid Al-Rashid",
    role: "Investor, Riyadh",
    avatar: "https://i.pravatar.cc/150?img=15",
  },
  {
    quote:
      "They understand that a house on Como is not a transaction. It is an inheritance you choose for your grandchildren.",
    name: "Sofia Bianchi",
    role: "Art Collector, Lake Como",
    avatar: "https://i.pravatar.cc/150?img=45",
  },
];

const TESTIMONIALS_ROW_2 = [
  {
    quote:
      "Selling a family estate is emotional. They handled the buyers, the paperwork and the press with absolute grace.",
    name: "James Whitmore",
    role: "Estate Owner, London",
    avatar: "https://i.pravatar.cc/150?img=33",
  },
  {
    quote:
      "Discreet, precise, and endlessly patient. Nine months of viewing, zero pressure, and the perfect penthouse in the end.",
    name: "Nikolai Petrov",
    role: "Private Client, Monaco",
    avatar: "https://i.pravatar.cc/150?img=20",
  },
  {
    quote:
      "Their valuation of my hotel was forty percent above every other agency's. They were also the only ones who were right.",
    name: "Camille Duret",
    role: "Boutique Hotelier, Paris",
    avatar: "https://i.pravatar.cc/150?img=59",
  },
  {
    quote:
      "One advisor, end to end, across two jurisdictions. That is not a service I expected to find anywhere.",
    name: "Richard Hale",
    role: "Family Office Principal, Zurich",
    avatar: "https://i.pravatar.cc/150?img=26",
  },
  {
    quote:
      "We handed them a bare plot in Abu Dhabi. They returned a sold-out tower with a waiting list. Enough said.",
    name: "Leila Haddad",
    role: "Developer, Abu Dhabi",
    avatar: "https://i.pravatar.cc/150?img=13",
  },
];

type Testimonial = (typeof TESTIMONIALS_ROW_1)[number];

function Card({ item }: { item: Testimonial }) {
  const reduceMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [12, -12]), {
    stiffness: 160,
    damping: 18,
  });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-14, 14]), {
    stiffness: 160,
    damping: 18,
  });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const handleLeave = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <div className="shrink-0 px-3" style={{ display: "flex" }}>
      <motion.div
        ref={cardRef}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{
          rotateX: reduceMotion ? 0 : rotateX,
          rotateY: reduceMotion ? 0 : rotateY,
          transformPerspective: 900,
        }}
        className="group flex h-full w-[320px] flex-col justify-between rounded-3xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md transition-[border-color,box-shadow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-gold/40 hover:shadow-[0_20px_60px_rgba(212,169,95,0.15)] sm:w-[380px] md:p-10"
      >
        <div>
          <Quote
            className="mb-6 h-9 w-9 text-gold/90 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-110"
            aria-hidden
          />
          <p className="mb-8 text-[1.05rem] font-medium leading-relaxed text-white/85">
            {item.quote}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-gold/30 shadow-[0_0_16px_rgba(212,169,95,0.25)] transition-colors duration-300 group-hover:border-gold/60">
            <Image
              src={item.avatar}
              alt={item.name}
              fill
              sizes="48px"
              className="object-cover"
            />
          </span>
          <span>
            <span className="block text-base font-semibold tracking-wide text-gold">
              {item.name}
            </span>
            <span className="block text-sm font-medium text-muted">
              {item.role}
            </span>
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function Track({
  items,
  direction,
  index,
}: {
  items: Testimonial[];
  direction: "left" | "right";
  index: 1 | 2;
}) {
  const doubled = [...items, ...items];
  return (
    // Wrapper carries the GSAP entrance tween; the inner div carries the
    // CSS marquee animation. Both animate `transform`, and CSS animations
    // override inline styles — same element would make the GSAP tween dead.
    <div data-v2={`track-${index}`}>
      <div
        className={`marquee-track-v2 flex w-max ${
          direction === "left" ? "marquee-left-v2" : "marquee-right-v2"
        }`}
        onTouchStart={(e) => {
          (e.currentTarget as HTMLElement).style.animationPlayState = "paused";
        }}
        onTouchEnd={(e) => {
          (e.currentTarget as HTMLElement).style.animationPlayState = "running";
        }}
      >
        {doubled.map((item, i) => (
          <Card key={`${item.name}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

export default function TestimonialsV2() {
  const rootRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sceneRotateX = useSpring(useTransform(my, [-1, 1], [5, -5]), {
    stiffness: 60,
    damping: 20,
  });
  const sceneRotateY = useSpring(useTransform(mx, [-1, 1], [-7, 7]), {
    stiffness: 60,
    damping: 20,
  });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mx.set((e.clientX - window.innerWidth / 2) / (window.innerWidth / 2));
      my.set((e.clientY - window.innerHeight / 2) / (window.innerHeight / 2));
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [mx, my]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (reduceMotion) {
      // Reveal everything instantly; skip entrance tweens entirely.
      gsap.set(
        '[data-v2="heading"], [data-v2="subline"], [data-v2="track-container"], [data-v2="track-1"], [data-v2="track-2"], [data-v2="ambient"]',
        { opacity: 1, y: 0, yPercent: 0, clipPath: "inset(0 0 0% 0)" }
      );
      gsap.set('[data-v2="ambient"]', { opacity: 0.55 });
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '[data-v2="heading"]',
        { yPercent: 40, opacity: 0, clipPath: "inset(0 0 100% 0)" },
        {
          yPercent: 0,
          opacity: 1,
          clipPath: "inset(0 0 0% 0)",
          duration: 1.1,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        }
      );
      gsap.fromTo(
        '[data-v2="subline"]',
        { y: 24, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          delay: 0.25,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        }
      );
      gsap.fromTo(
        '[data-v2="track-container"]',
        { opacity: 0 },
        {
          opacity: 1,
          duration: 1.4,
          delay: 0.4,
          ease: "power2.out",
          scrollTrigger: { trigger: root, start: "top 70%" },
        }
      );
      gsap.fromTo(
        '[data-v2="track-1"]',
        { x: -140, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 1.3,
          delay: 0.45,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 70%" },
        }
      );
      gsap.fromTo(
        '[data-v2="track-2"]',
        { x: 140, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 1.3,
          delay: 0.6,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 70%" },
        }
      );
      gsap.fromTo(
        '[data-v2="ambient"]',
        { opacity: 0 },
        {
          opacity: 0.55,
          duration: 2,
          ease: "power2.out",
          scrollTrigger: { trigger: root, start: "top 70%" },
        }
      );
    }, root);
    return () => ctx.revert();
  }, [reduceMotion]);

  return (
    <section
      ref={rootRef}
      id="testimonials"
      className="relative overflow-hidden bg-[#050505] py-20 md:py-28"
    >
      <div
        data-v2="ambient"
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-0"
      >
        <div className="absolute left-1/2 top-0 h-[60vh] w-[80vw] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-[120px]" />
      </div>

      {!reduceMotion && (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
          <Canvas
            dpr={[1, 1.5]}
            camera={{ position: [0, 0, 10], fov: 60 }}
            gl={{ alpha: true, antialias: false }}
          >
            <Sparkles
              count={130}
              scale={[24, 9, 2]}
              size={2.2}
              speed={0.25}
              opacity={0.5}
              color="#d4a95f"
            />
          </Canvas>
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-[1440px] px-6 lg:px-12">
        <header className="mb-16 text-center">
          <h2
            data-v2="heading"
            className="font-display text-5xl tracking-wide text-white opacity-0 md:text-7xl"
          >
            IN THEIR WORDS
          </h2>
          <p
            data-v2="subline"
            className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted opacity-0"
          >
            Private clients, collectors, and estate owners on what it is like
            to be represented by LUXONN.
          </p>
        </header>

        <div style={{ perspective: "1350px" }}>
          <motion.div
            style={{
              rotateX: reduceMotion ? 0 : sceneRotateX,
              rotateY: reduceMotion ? 0 : sceneRotateY,
              transformStyle: "preserve-3d",
            }}
          >
            <div
              data-v2="track-container"
              className="fade-edges-v2 w-full pb-8 opacity-0"
            >
              <Track items={TESTIMONIALS_ROW_1} direction="left" index={1} />
              <div className="h-6" />
              <Track items={TESTIMONIALS_ROW_2} direction="right" index={2} />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
