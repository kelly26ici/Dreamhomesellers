import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { LoginAmbient } from "@/components/ui/login-form";
import { SignupForm } from "@/components/ui/signup-form";

export const metadata = {
  title: "Create Account — LUXONN",
  description:
    "Create a LUXONN account to save residences, request viewings, and list your own.",
};

export default function SignupPage() {
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
        {/* ?next= is read under cacheComponents — keep it in a boundary. */}
        <Suspense
          fallback={
            <div
              aria-busy="true"
              className="w-full max-w-sm space-y-8 rounded-lg border border-gold/15 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)] md:p-10"
            >
              <div className="h-8 w-48 animate-pulse rounded bg-surface-2" />
              <div className="h-10 w-full animate-pulse rounded bg-surface-2" />
              <div className="h-12 w-full animate-pulse rounded bg-surface-2" />
            </div>
          }
        >
          <SignupForm />
        </Suspense>
      </div>
    </main>
  );
}
