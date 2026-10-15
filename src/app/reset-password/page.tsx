import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { LoginAmbient } from "@/components/ui/login-form";
import { ResetPasswordForm } from "@/components/ui/reset-password-form";

export const metadata = {
  title: "New Password — LUXONN",
  description: "Choose a new password for your LUXONN account.",
};

export default function ResetPasswordPage() {
  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-24">
      <LoginAmbient />
      <Link
        href="/"
        className="absolute left-6 top-6 z-10 flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold lg:left-12"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        BACK TO SITE
      </Link>
      <div className="relative z-10 w-full max-w-sm">
        {/* The form only works when the recovery session exists (established
            by /auth/callback) — the boundary keeps the page shell instant. */}
        <Suspense
          fallback={
            <div
              aria-busy="true"
              className="w-full max-w-sm space-y-8 rounded-3xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md md:p-10"
            >
              <div className="h-8 w-48 animate-pulse rounded bg-surface-2" />
              <div className="h-10 w-full animate-pulse rounded bg-surface-2" />
              <div className="h-12 w-full animate-pulse rounded bg-surface-2" />
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
