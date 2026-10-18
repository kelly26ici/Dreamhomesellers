import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ProtocolChat } from '@/components/simon/ProtocolChat';

export const metadata: Metadata = {
  title: 'Simon Concierge — LUXONN',
  description:
    'A full-page concierge session with Simon: tokens stream as he thinks, and every search he runs is shown as it happens.',
};

export default function SimonChatPage() {
  return (
    <main className="relative min-h-screen bg-[#050505]">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-24 lg:px-12">
        <Link
          href="/"
          className="absolute left-6 top-6 z-10 flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold lg:left-12"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          LUXONN
        </Link>

        <header className="mb-10">
          <p className="text-xs tracking-[0.3em] text-gold">SIMON CONCIERGE</p>
          <h1 className="mt-3 font-display text-4xl tracking-wide text-white md:text-5xl">
            Ask about the collection
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            Simon searches the published Kenyan catalogue as he answers, and shows
            every search as it runs. Prices and availability come straight from
            the verified record — never invented.
          </p>
        </header>

        <ProtocolChat />
      </div>
    </main>
  );
}
