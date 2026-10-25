import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { NativeSimonChat } from '@/components/simon/NativeSimonChat';

export const metadata: Metadata = {
  title: 'Simon Concierge — LUXONN',
  description:
    'A full-page concierge session with Simon: tokens stream as he thinks, and every search he runs is shown as it happens.',
};

export default function SimonChatPage() {
  return (
    <main className="relative flex h-screen flex-col bg-[#050505]">
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-4 lg:px-12">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          LUXONN
        </Link>
      </div>

      <div className="min-h-0 flex-1">
        <NativeSimonChat />
      </div>
    </main>
  );
}
