"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Search, Menu } from "lucide-react";
import { useLenis } from "lenis/react";

const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "Properties", href: "#properties" },
  { label: "About", href: "#about" },
  { label: "Services", href: "#services" },
  { label: "Contact", href: "#contact" },
];

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const magnetRef = useRef<HTMLButtonElement>(null);
  const lenis = useLenis();

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!rootRef.current) return;
    gsap.fromTo(
      rootRef.current,
      { y: -80, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, ease: "power3.out" }
    );
  }, []);

  useEffect(() => {
    const magnet = magnetRef.current;
    if (!magnet) return;
    const xTo = gsap.quickTo(magnet, "x", { duration: 0.4, ease: "power3" });
    const yTo = gsap.quickTo(magnet, "y", { duration: 0.4, ease: "power3" });
    const onMove = (e: MouseEvent) => {
      const rect = magnet.getBoundingClientRect();
      xTo((e.clientX - (rect.left + rect.width / 2)) * 0.3);
      yTo((e.clientY - (rect.top + rect.height / 2)) * 0.3);
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
    };
    magnet.addEventListener("mousemove", onMove);
    magnet.addEventListener("mouseleave", onLeave);
    return () => {
      magnet.removeEventListener("mousemove", onMove);
      magnet.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const scrollTo = (href: string) => {
    setMenuOpen(false);
    if (lenis) {
      lenis.scrollTo(href, { offset: -72 });
    } else {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header
      ref={rootRef}
      className={`fixed top-0 left-0 z-50 w-full transition-all duration-500 ${
        isScrolled
          ? "border-b border-white/10 bg-black/70 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-6 lg:px-12">
        <button
          type="button"
          onClick={() => scrollTo("#home")}
          className="flex items-center gap-2"
          aria-label="LUXONN home"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold">
            <span className="font-display text-lg leading-none text-gold">L</span>
          </span>
          <span className="font-display text-2xl tracking-widest">LUXONN</span>
        </button>

        <ul className="hidden items-center gap-10 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <button
                type="button"
                onClick={() => scrollTo(link.href)}
                className="text-sm tracking-[0.2em] text-muted transition-colors hover:text-white"
              >
                {link.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="Search"
            className="hidden text-muted transition-colors hover:text-white sm:block"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            ref={magnetRef}
            type="button"
            onClick={() => scrollTo("#contact")}
            className="hidden border border-gold/60 px-6 py-2.5 text-sm tracking-[0.15em] text-gold transition-all duration-300 hover:border-gold hover:bg-gold/10 hover:shadow-[0_0_30px_rgba(212,169,95,0.35)] md:block"
          >
            Book Viewing
          </button>
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="text-white md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="glass border-t border-white/10 md:hidden">
          <ul className="flex flex-col gap-1 px-6 py-4">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <button
                  type="button"
                  className="w-full py-2 text-left text-sm tracking-[0.2em] text-muted hover:text-white"
                  onClick={() => scrollTo(link.href)}
                >
                  {link.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
