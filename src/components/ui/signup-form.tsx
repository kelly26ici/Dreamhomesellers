"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, User, ArrowRight } from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

/**
 * LUXONN registration — email/password sign-up that also bootstraps the
 * ADR-012 solo organization (create_solo_organization RPC exists since
 * migration 0003; a signed-in user without a membership is a dead end in
 * the owner portal, so the RPC runs immediately after sign-up succeeds).
 */
export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Same open-redirect guard as the login form: only same-site targets.
  const nextPath = (() => {
    const raw = searchParams.get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/owner";
  })();

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (agencyName.trim().length < 2) {
      setFormError("Please enter a name for your listings business.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const origin = window.location.origin;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Confirmation links land on the callback route, which forwards
          // to nextPath after the session is established.
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
          data: { display_name: agencyName.trim() },
        },
      });

      if (error) {
        setFormError(error.message);
        return;
      }

      // When email confirmation is required, Supabase returns a user with
      // no session — surface the explicit instruction instead of bouncing.
      if (data.session) {
        await bootstrapOrganization(agencyName.trim());
        router.replace(nextPath);
        router.refresh();
      } else {
        setNotice(
          "Confirm your email to finish — we've sent a confirmation link to " +
            email +
            ". After confirming, your solo listing organization is created automatically.",
        );
      }
    } catch {
      setFormError("Sign-up failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function bootstrapOrganization(displayName: string) {
    try {
      await getSupabaseBrowserClient().rpc("create_solo_organization", {
        p_display_name: displayName,
        p_idempotency_key: crypto.randomUUID(),
      });
    } catch {
      // Non-fatal: the owner portal surfaces an organization-creation
      // prompt when a membership is missing, so a relay failure here
      // doesn't strand the account.
    }
  }

  return (
    <div className="w-full max-w-sm space-y-8 rounded-3xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md md:p-10">
      <div className="text-center">
        <h2 className="font-display text-4xl tracking-wide text-white">
          JOIN LUXONN
        </h2>
        <p className="mt-3 text-sm text-muted">
          Create a seller account to list and manage residences.
        </p>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200"
        >
          {notice}
        </p>
      )}
      {formError && (
        <p
          role="alert"
          className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200"
        >
          {formError}
        </p>
      )}

      <form onSubmit={handleSignUp} className="space-y-5">
        <div className="relative">
          <input
            id="agency-name"
            type="text"
            required
            minLength={2}
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
            placeholder=" "
            className="peer w-full border-b border-white/20 bg-transparent px-1 pb-2 pt-6 text-white outline-none transition-colors focus:border-gold"
          />
          <label
            htmlFor="agency-name"
            className="pointer-events-none absolute left-1 top-2 text-[10px] tracking-[0.2em] text-muted transition-all peer-placeholder-shown:top-5 peer-placeholder-shown:text-sm peer-focus:top-2 peer-focus:text-[10px]"
          >
            BUSINESS / AGENCY NAME
          </label>
          <User className="absolute right-1 top-6 h-4 w-4 text-muted" aria-hidden />
        </div>

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

        <div className="relative">
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder=" "
            className="peer w-full border-b border-white/20 bg-transparent px-1 pb-2 pt-6 text-white outline-none transition-colors focus:border-gold"
          />
          <label
            htmlFor="password"
            className="pointer-events-none absolute left-1 top-2 text-[10px] tracking-[0.2em] text-muted transition-all peer-placeholder-shown:top-5 peer-placeholder-shown:text-sm peer-focus:top-2 peer-focus:text-[10px]"
          >
            PASSWORD
          </label>
          <Lock className="absolute right-1 top-6 h-4 w-4 text-muted" aria-hidden />
          <p className="mt-1 text-[10px] text-muted">Minimum 8 characters.</p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="group w-full border border-gold bg-gold px-8 py-3.5 text-sm tracking-[0.15em] text-black transition-all duration-300 hover:shadow-[0_0_40px_rgba(212,169,95,0.5)] focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-[#050505] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "CREATING ACCOUNT…" : "CREATE ACCOUNT"}
          <ArrowRight className="ml-2 inline h-4 w-4 transition-transform group-hover:translate-x-1" />
        </button>
      </form>

      <p className="text-center text-xs text-muted">
        Already have an account?{" "}
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
