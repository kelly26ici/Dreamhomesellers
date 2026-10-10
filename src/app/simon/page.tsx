import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connection } from "next/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Simon — LUXONN Property Concierge",
  description:
    "Find, compare, and arrange viewings for exceptional residences with Simon, the LUXONN property concierge.",
};

export default async function SimonPage() {
  await connection();
  const simonUrl = process.env.SIMON_URL ?? "http://localhost:8931";

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/10 px-6 lg:px-12">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          BACK TO SITE
        </Link>
        <span className="font-display text-2xl tracking-widest text-gold">
          SIMON
        </span>
      </header>
      <iframe
        src={simonUrl}
        title="Simon, LUXONN property concierge"
        className="min-h-0 flex-1 border-0"
        allow="clipboard-read; clipboard-write"
      />
    </main>
  );
}
