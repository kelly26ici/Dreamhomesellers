"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Menu, LayoutDashboard, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useLenis } from "lenis/react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/auth/supabase-browser";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const magnetRef = useRef<HTMLAnchorElement>(null);
  const lenis = useLenis();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Derive current kind from URL so nav links reflect active state (ADR-006:
  // URL is the single source of truth). Mirrors FilterBar's kind vocabulary.
  const currentKind = searchParams.get("kind");
  const kinds = currentKind ? currentKind.split(",") : [];
  const isKindActive = (kind: string) => kinds.includes(kind);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }: { data: { user: SupabaseUser | null } }) => {
      setUser(data.user);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event: string, session: { user: SupabaseUser | null } | null) => {
      setUser(session?.user ?? null);
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
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
  }, [user]);

  const scrollToAbout = () => {
    setMenuOpen(false);
    if (pathname === "/") {
      if (lenis) {
        lenis.scrollTo("#about", { offset: -72 });
      } else {
        document.querySelector("#about")?.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      router.push("/#about");
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
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="LUXONN home"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold">
            <span className="font-display text-lg leading-none text-gold">L</span>
          </span>
          <span className="font-display text-2xl tracking-widest">LUXONN</span>
        </Link>

        {/* Primary Buyer Nav — active state derived from URL kind param (ADR-006) */}
        <ul className="hidden items-center gap-8 md:flex">
          <li>
            <Link
              href="/properties?kind=sale"
              className={`inline-flex items-center gap-1.5 text-sm tracking-[0.2em] transition-colors ${
                isKindActive("sale")
                  ? "font-semibold text-gold"
                  : "text-muted hover:text-gold"
              }`}
              aria-current={isKindActive("sale") ? "page" : undefined}
            >
              <span
                className={`h-1 w-1 rounded-full ${
                  isKindActive("sale") ? "bg-gold" : "bg-white/20"
                }`}
                aria-hidden="true"
              />
              BUY
            </Link>
          </li>
          <li>
            <Link
              href="/properties?kind=rent"
              className={`inline-flex items-center gap-1.5 text-sm tracking-[0.2em] transition-colors ${
                isKindActive("rent")
                  ? "font-semibold text-gold"
                  : "text-muted hover:text-gold"
              }`}
              aria-current={isKindActive("rent") ? "page" : undefined}
            >
              <span
                className={`h-1 w-1 rounded-full ${
                  isKindActive("rent") ? "bg-gold" : "bg-white/20"
                }`}
                aria-hidden="true"
              />
              RENT
            </Link>
          </li>
          <li>
            <Link
              href="/properties"
              className={`text-sm tracking-[0.2em] transition-colors ${
                kinds.length === 0
                  ? "font-semibold text-gold"
                  : "text-muted hover:text-white"
              }`}
              aria-current={kinds.length === 0 ? "page" : undefined}
            >
              ALL PROPERTIES
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={scrollToAbout}
              className="text-sm tracking-[0.2em] text-muted transition-colors hover:text-white"
            >
              ABOUT
            </button>
          </li>
        </ul>

        {/* Right Action Cluster */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link
                href="/owner/listings/new"
                className="hidden items-center gap-1.5 border border-gold/40 bg-gold/10 px-4 py-2 text-xs tracking-[0.15em] text-gold transition-all duration-300 hover:border-gold hover:bg-gold/20 sm:flex"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                <span>LIST RESIDENCE</span>
              </Link>
              <Link
                href="/owner"
                className="hidden items-center gap-2 border border-gold/70 bg-gold px-5 py-2 text-xs font-semibold tracking-[0.15em] text-black transition-all duration-300 hover:shadow-[0_0_30px_rgba(212,169,95,0.4)] sm:flex"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                <span>OWNER PORTAL</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold sm:block"
              >
                Sign In
              </Link>
              <Link
                href="/login?next=/owner/listings/new"
                ref={magnetRef}
                className="hidden border border-gold/60 px-6 py-2.5 text-sm tracking-[0.15em] text-gold transition-all duration-300 hover:border-gold hover:bg-gold/10 hover:shadow-[0_0_30px_rgba(212,169,95,0.35)] md:block"
              >
                List Property
              </Link>
            </>
          )}

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

      {/* Mobile Drawer */}
      {menuOpen && (
        <div className="glass border-t border-white/10 md:hidden">
          <ul className="flex flex-col gap-1 px-6 py-4">
            <li>
              <Link
                href="/properties?kind=sale"
                className={`flex w-full items-center gap-1.5 py-2 text-left text-sm tracking-[0.2em] transition-colors ${
                  isKindActive("sale")
                    ? "font-semibold text-gold"
                    : "text-muted hover:text-gold"
                }`}
                aria-current={isKindActive("sale") ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <span
                  className={`h-1 w-1 rounded-full ${
                    isKindActive("sale") ? "bg-gold" : "bg-white/20"
                  }`}
                  aria-hidden="true"
                />
                BUY
              </Link>
            </li>
            <li>
              <Link
                href="/properties?kind=rent"
                className={`flex w-full items-center gap-1.5 py-2 text-left text-sm tracking-[0.2em] transition-colors ${
                  isKindActive("rent")
                    ? "font-semibold text-gold"
                    : "text-muted hover:text-gold"
                }`}
                aria-current={isKindActive("rent") ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <span
                  className={`h-1 w-1 rounded-full ${
                    isKindActive("rent") ? "bg-gold" : "bg-white/20"
                  }`}
                  aria-hidden="true"
                />
                RENT
              </Link>
            </li>
            <li>
              <Link
                href="/properties"
                className={`block w-full py-2 text-left text-sm tracking-[0.2em] transition-colors ${
                  kinds.length === 0
                    ? "font-semibold text-gold"
                    : "text-muted hover:text-white"
                }`}
                aria-current={kinds.length === 0 ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                ALL PROPERTIES
              </Link>
            </li>
            <li>
              <button
                type="button"
                className="w-full py-2 text-left text-sm tracking-[0.2em] text-muted hover:text-white"
                onClick={scrollToAbout}
              >
                ABOUT
              </button>
            </li>
            <li className="border-t border-white/10 pt-2 mt-2">
              {user ? (
                <div className="flex flex-col gap-2">
                  <Link
                    href="/owner/listings/new"
                    className="block w-full py-2 text-left text-sm tracking-[0.2em] text-gold font-semibold"
                    onClick={() => setMenuOpen(false)}
                  >
                    + LIST RESIDENCE
                  </Link>
                  <Link
                    href="/owner"
                    className="block w-full py-2 text-left text-sm tracking-[0.2em] text-gold font-semibold"
                    onClick={() => setMenuOpen(false)}
                  >
                    OWNER PORTAL
                  </Link>
                  <Link
                    href="/owner"
                    className="block w-full py-2 text-left text-xs tracking-[0.15em] text-muted hover:text-red-400"
                    onClick={() => setMenuOpen(false)}
                  >
                    SIGN OUT — FROM THE OWNER PORTAL
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link
                    href="/login"
                    className="block w-full py-2 text-left text-sm tracking-[0.2em] text-gold hover:text-champagne"
                    onClick={() => setMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/login?next=/owner/listings/new"
                    className="block w-full py-2 text-left text-sm tracking-[0.2em] text-white/80 hover:text-gold"
                    onClick={() => setMenuOpen(false)}
                  >
                    List Property
                  </Link>
                </div>
              )}
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
