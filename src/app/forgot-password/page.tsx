import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoginAmbient } from "@/components/ui/login-form";
import { ForgotPasswordForm } from "@/components/ui/forgot-password-form";

export const metadata = {
  title: "Reset Password — LUXONN",
  description: "Request a secure password reset link for your LUXONN account.",
};

export default function ForgotPasswordPage() {
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
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
