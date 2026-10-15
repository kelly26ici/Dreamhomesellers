"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { User, Lock, ArrowRight } from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

// Keep three.js out of the /login initial bundle — the R3F canvas loads from
// its own client-only chunk after hydration.
const LoginSparkles = dynamic(() => import("./LoginSparkles"), { ssr: false });

// Constant subscription for the mount gate below — nothing to observe,
// the client snapshot differing from the server snapshot is the signal.
const subscribeNoop = () => () => {};

/**
 * Ambient gold background that matches the site's visual language:
 * R3F gold sparkles over deep-black with soft gold blur glows — the same
 * treatment as the Testimonials V2 section, replacing the old WebGL smoke.
 */
export function LoginAmbient({
  className = "",
}: {
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  // Mount gate: SSR and the first client render must agree (no canvas on
  // either), or React 19 flags a hydration mismatch for reduced-motion users.
  // useSyncExternalStore does this without the setState-in-effect cascade
  // the classic `useState(false) + useEffect` gate triggers.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div className="absolute left-1/2 top-[-25%] h-[70vh] w-[85vw] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-[120px]" />
      <div className="absolute bottom-[-30%] right-[-15%] h-[55vh] w-[55vw] rounded-full bg-champagne/[0.04] blur-[100px]" />

      {mounted && !reduceMotion && (
        <LoginSparkles
          scale={[24, 12, 4]}
          size={2.4}
          speed={0.2}
        />
      )}
    </div>
  );
}

/**
 * LUXONN login form — glassmorphism with floating labels and Google login,
 * styled to match the site: font-display heading, Hero-style gold button,
 * and the Testimonials V2 card treatment.
 */
export function LoginForm() {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Where to land after sign-in: the consent flow passes ?next= so an
  // interrupted authorization resumes on the same request. Never accept
  // an off-site redirect target (open-redirect guard).
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nextPath = (() => {
    const raw = searchParams.get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  })();

  // Google identity provider: the redirect lands on /auth/callback, which
  // exchanges the PKCE code server-side and resumes nextPath.
  async function handleGoogleSignIn() {
    setFormError(null);
    try {
      await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
    } catch {
      setFormError("Could not start Google sign-in. Please try again.");
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      router.replace(nextPath);
    } catch {
      setFormError("Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (reduceMotion) {
      // Reveal everything instantly; skip entrance tweens entirely.
      gsap.set("[data-login='heading'], [data-login='fade'], [data-login='form']", {
        opacity: 1,
        y: 0,
        yPercent: 0,
      });
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-login='heading']",
        { yPercent: 60, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 1.1, ease: "power3.out" }
      );
      gsap.fromTo(
        "[data-login='fade']",
        { y: 24, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.12,
          delay: 0.2,
          ease: "power3.out",
        }
      );
      gsap.fromTo(
        "[data-login='form']",
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, delay: 0.35, ease: "power3.out" }
      );
    }, root);
    return () => ctx.revert();
  }, [reduceMotion]);

  return (
    <div
      ref={rootRef}
      className="w-full max-w-sm space-y-8 rounded-3xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md md:p-10"
    >
      <div className="text-center">
        <h2
          data-login="heading"
          className="font-display text-4xl tracking-wide text-white opacity-0"
        >
          WELCOME BACK
        </h2>
        <p
          data-login="fade"
          className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted opacity-0"
        >
          Sign in to access your private collection and saved residences.
        </p>
      </div>
      <form
        data-login="form"
        onSubmit={handleSignIn}
        className="space-y-8 opacity-0"
      >
        {formError && (
          <p role="alert" className="text-sm text-red-400">
            {formError}
          </p>
        )}
        {/* Email Input with Animated Label */}
        <div className="relative z-0">
          <input
            type="email"
            id="floating_email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            className="block w-full appearance-none border-0 border-b-2 border-white/20 bg-transparent py-2.5 px-0 text-sm text-white transition-colors duration-300 focus:border-gold focus:outline-none focus:ring-0 peer"
            placeholder=" "
            required
          />
          <label
            htmlFor="floating_email"
            className="absolute top-3 -z-10 origin-[0] -translate-y-6 scale-75 text-sm text-muted duration-300 transform peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:left-0 peer-focus:text-gold peer-focus:scale-75 peer-focus:-translate-y-6"
          >
            <User className="-mt-1 mr-2 inline-block" size={16} aria-hidden />
            Email Address
          </label>
        </div>
        {/* Password Input with Animated Label */}
        <div className="relative z-0">
          <input
            type="password"
            id="floating_password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            className="block w-full appearance-none border-0 border-b-2 border-white/20 bg-transparent py-2.5 px-0 text-sm text-white transition-colors duration-300 focus:border-gold focus:outline-none focus:ring-0 peer"
            placeholder=" "
            required
          />
          <label
            htmlFor="floating_password"
            className="absolute top-3 -z-10 origin-[0] -translate-y-6 scale-75 text-sm text-muted duration-300 transform peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:left-0 peer-focus:text-gold peer-focus:scale-75 peer-focus:-translate-y-6"
          >
            <Lock className="-mt-1 mr-2 inline-block" size={16} aria-hidden />
            Password
          </label>
        </div>

        <div className="flex items-center justify-between" data-login="fade">
          <a href="#" className="text-xs text-muted transition hover:text-white">
            <Link href="/forgot-password">Forgot Password?</Link>
          </a>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="group w-full border border-gold bg-gold px-8 py-3.5 text-sm tracking-[0.15em] text-black transition-all duration-300 hover:shadow-[0_0_40px_rgba(212,169,95,0.5)] focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-[#050505] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Signing In…" : "Sign In"}
          <ArrowRight
            className="ml-2 inline h-4 w-4 transform transition-transform group-hover:translate-x-1"
            aria-hidden
          />
        </button>

        {/* Divider */}
        <div className="relative flex items-center py-2" data-login="fade">
          <div className="flex-grow border-t border-white/10"></div>
          <span className="mx-4 flex-shrink text-xs tracking-[0.2em] text-muted">
            OR CONTINUE WITH
          </span>
          <div className="flex-grow border-t border-white/10"></div>
        </div>

        {/* Google Login Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="w-full border border-white/30 px-4 py-2.5 text-sm tracking-[0.15em] text-white transition-all duration-300 hover:border-white hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-[#050505]"
        >
          <svg className="mr-2 inline h-5 w-5" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039L38.802 8.841C34.553 4.806 29.613 2.5 24 2.5C11.983 2.5 2.5 11.983 2.5 24s9.483 21.5 21.5 21.5S45.5 36.017 45.5 24c0-1.538-.135-3.022-.389-4.417z"></path>
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12.5 24 12.5c3.059 0 5.842 1.154 7.961 3.039l5.839-5.841C34.553 4.806 29.613 2.5 24 2.5C16.318 2.5 9.642 6.723 6.306 14.691z"></path>
            <path fill="#4CAF50" d="M24 45.5c5.613 0 10.553-2.306 14.802-6.341l-5.839-5.841C30.842 35.846 27.059 38 24 38c-5.039 0-9.345-2.608-11.124-6.481l-6.571 4.819C9.642 41.277 16.318 45.5 24 45.5z"></path>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l5.839 5.841C44.196 35.123 45.5 29.837 45.5 24c0-1.538-.135-3.022-.389-4.417z"></path>
          </svg>
          Google
        </button>
      </form>
      <p className="text-center text-xs text-muted" data-login="fade">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-semibold text-gold transition hover:text-champagne"
        >
          Sign Up
        </Link>
      </p>
    </div>
  );
}
