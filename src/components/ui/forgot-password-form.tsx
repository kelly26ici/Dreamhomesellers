"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

/**
 * Password-reset request. Always shows the same confirmation either way
 * (never reveals whether an email is registered — an enumeration vector),
 * and the reset link lands on /reset-password via the callback route.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      const { error: resetError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (resetError) {
        setError(resetError.message);
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Could not send the reset link. Please try again.");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <div className="w-full max-w-sm space-y-6 rounded-3xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md md:p-10">
        <h2 className="font-display text-4xl tracking-wide text-white">
          CHECK YOUR EMAIL
        </h2>
        <p
          role="status"
          className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200"
        >
          If an account exists for <strong>{email}</strong>, a password reset
          link is on its way. The link expires after one hour.
        </p>
        <Link
          href="/login"
          className="block w-full border border-white/30 px-4 py-3 text-center text-sm tracking-[0.15em] text-white transition-colors hover:border-gold hover:text-gold"
        >
          BACK TO SIGN IN
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-8 rounded-3xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md md:p-10">
      <div className="text-center">
        <h2 className="font-display text-4xl tracking-wide text-white">
          RESET PASSWORD
        </h2>
        <p className="mt-3 text-sm text-muted">
          Enter your email and we&apos;ll send a secure reset link.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="relative">
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder=" "
            className="peer w-full border-b border-white/20 bg-transparent px-1 pb-2 pt-6 text-white outline-none transition-colors focus:border-gold"
          />
          <label
            htmlFor="email"
            className="pointer-events-none absolute left-1 top-2 text-[10px] tracking-[0.2em] text-muted transition-all peer-placeholder-shown:top-5 peer-placeholder-shown:text-sm peer-focus:top-2 peer-focus:text-[10px]"
          >
            EMAIL ADDRESS
          </label>
          <Mail className="absolute right-1 top-6 h-4 w-4 text-muted" aria-hidden />
        </div>

        <button
          type="submit"
          disabled={status === "sending"}
          className="group w-full border border-gold bg-gold px-8 py-3.5 text-sm tracking-[0.15em] text-black transition-all duration-300 hover:shadow-[0_0_40px_rgba(212,169,95,0.5)] focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-[#050505] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "sending" ? "SENDING…" : "SEND RESET LINK"}
          <ArrowRight className="ml-2 inline h-4 w-4 transition-transform group-hover:translate-x-1" />
        </button>
      </form>

      <p className="text-center text-xs text-muted">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-semibold text-gold transition hover:text-champagne"
        >
          Sign In
        </Link>
      </p>
    </div>
  );
}
