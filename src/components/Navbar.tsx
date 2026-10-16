"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Menu, Search, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useLenis } from "lenis/react";
import { useRouter, usePathname } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/auth/supabase-browser";
import type { User as SupabaseUser } from "@supabase/supabase-js";

/** Marketing sections the nav scrolls to. Mirrors the first commits. */
const SECTIONS = ["home", "properties", "about", "services"] as const;

const NAV_OFFSET = -72;

/** Lenis is JS-driven, so the global reduced-motion CSS block does not cover it. */
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Lenis owns the scroll position when it is mounted (html.lenis), so native
 * scrollIntoView/window.scrollBy are ignored. Route through lenis when present
 * and fall back to native scrolling otherwise. Lenis is JS-driven, so the
 * global prefers-reduced-motion CSS block does not cover it — check explicitly.
 */
function scrollToAnchor(id: string, lenis: ReturnType<typeof useLenis>) {
  const reduced = prefersReducedMotion();
  if (lenis && !reduced) {
    lenis.scrollTo(`#${id}`, { offset: NAV_OFFSET });
    return;
  }
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  if (!reduced) {
    window.scrollBy(0, NAV_OFFSET);
  }
}

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const magnetRef = useRef<HTMLAnchorElement>(null);
  const lenis = useLenis();
  const router = useRouter();
  const pathname = usePathname();

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

  /**
   * Section scroll that works from any route: on "/" scroll in place, elsewhere
   * go home first and scroll once the target exists. The featured rail streams
   * in inside a Suspense boundary, so the scroll is retried briefly until the
   * anchor is present rather than silently doing nothing.
   */
  const scrollToSection = (id: string) => {
    setMenuOpen(false);
    if (pathname === "/") {
      scrollToAnchor(id, lenis);
      return;
    }
    router.push("/");
    let tries = 0;
    const attempt = () => {
      if (document.getElementById(id)) {
        scrollToAnchor(id, lenis);
        return;
      }
      if (tries++ < 40) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
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

        {/* Primary nav — marketing sections, scrolling as the first commits did.
            The featured listings rail (id="properties") is the target, so these
            scroll rather than navigate; only SEARCH reaches the /properties grid. */}
        <ul className="hidden items-center gap-8 md:flex">
          {SECTIONS.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => scrollToSection(id)}
                className="text-sm tracking-[0.2em] text-muted uppercase transition-colors hover:text-gold"
              >
                {id}
              </button>
            </li>
          ))}
        </ul>

        {/* Right Action Cluster */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link
                href="/owner/listings/new"
                className="hidden items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-xs tracking-[0.15em] text-gold transition-all duration-300 hover:border-gold hover:bg-gold/20 sm:flex"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                <span>LIST RESIDENCE</span>
              </Link>
              <Link
                href="/owner"
                className="hidden items-center gap-2 rounded-md border border-white/20 px-4 py-2 text-xs tracking-[0.15em] text-muted transition-all duration-300 hover:border-gold/50 hover:text-gold sm:flex"
              >
                <span>OWNER PORTAL</span>
              </Link>
              <Link
                href="/properties"
                className="hidden items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-2 text-xs font-semibold tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold/20 sm:flex"
              >
                <Search className="h-3.5 w-3.5" />
                <span>SEARCH</span>
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
                href="/properties"
                className="hidden items-center gap-2 rounded-md border border-gold/60 px-5 py-2.5 text-sm tracking-[0.15em] text-gold transition-all duration-300 hover:border-gold hover:bg-gold/10 hover:shadow-[0_0_30px_rgba(212,169,95,0.35)] sm:flex"
              >
                <Search className="h-3.5 w-3.5" />
                <span>SEARCH</span>
              </Link>
              <Link
                href="/login?next=/owner/listings/new"
                ref={magnetRef}
                className="hidden rounded-md border border-gold/60 px-6 py-2.5 text-sm tracking-[0.15em] text-gold transition-all duration-300 hover:border-gold hover:bg-gold/10 hover:shadow-[0_0_30px_rgba(212,169,95,0.35)] md:block"
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
            {SECTIONS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className="block w-full py-2 text-left text-sm tracking-[0.2em] text-muted uppercase hover:text-gold"
                >
                  {id}
                </button>
              </li>
            ))}
            <li>
              <Link
                href="/properties"
                className="flex w-full items-center gap-2 py-2 text-left text-sm tracking-[0.2em] text-gold"
                onClick={() => setMenuOpen(false)}
              >
                <Search className="h-4 w-4" />
                SEARCH
              </Link>
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
