"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, ArrowRight } from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

/**
 * Final step of the reset flow: the callback route has already exchanged
 * the recovery link for a session, so updateUser here commits the new
 * password on that session.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({
        password,
      });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      router.replace("/owner");
      router.refresh();
    } catch {
      setError("Could not update the password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-8 rounded-lg border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md md:p-10">
      <div className="text-center">
        <h2 className="font-display text-4xl tracking-wide text-white">
          NEW PASSWORD
        </h2>
        <p className="mt-3 text-sm text-muted">
          Choose a new password for your LUXONN account.
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
            NEW PASSWORD
          </label>
          <Lock className="absolute right-1 top-6 h-4 w-4 text-muted" aria-hidden />
        </div>

        <div className="relative">
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder=" "
            className="peer w-full border-b border-white/20 bg-transparent px-1 pb-2 pt-6 text-white outline-none transition-colors focus:border-gold"
          />
          <label
            htmlFor="confirm"
            className="pointer-events-none absolute left-1 top-2 text-[10px] tracking-[0.2em] text-muted transition-all peer-placeholder-shown:top-5 peer-placeholder-shown:text-sm peer-focus:top-2 peer-focus:text-[10px]"
          >
            CONFIRM PASSWORD
          </label>
          <Lock className="absolute right-1 top-6 h-4 w-4 text-muted" aria-hidden />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="group w-full rounded-md border border-gold bg-gold px-8 py-3.5 text-sm tracking-[0.15em] text-black transition-all duration-300 hover:shadow-[0_0_40px_rgba(212,169,95,0.5)] focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-[#050505] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "UPDATING…" : "UPDATE PASSWORD"}
          <ArrowRight className="ml-2 inline h-4 w-4 transition-transform group-hover:translate-x-1" />
        </button>
      </form>
    </div>
  );
}
