import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { connection } from 'next/server';
import { NativeSimonChat } from '@/components/simon/NativeSimonChat';
import type { PageContext } from '@/lib/contracts/page-context';
import type { ListingId } from '@/lib/contracts/shared';

export const instant = false;

export const metadata: Metadata = {
  title: 'Simon — LUXONN Property Concierge',
  description:
    'Find, compare, and arrange viewings for exceptional residences with Simon, the LUXONN property concierge.',
};

interface SimonPageProps {
  searchParams: Promise<{
    listingId?: string;
    title?: string;
    action?: string;
  }>;
}

export default async function SimonPage({ searchParams }: SimonPageProps) {
  await connection();
  const params = await searchParams;
  const listingId = params.listingId ? (params.listingId as ListingId) : null;
  const title = params.title || null;

  const pageContext: Partial<PageContext> = {
    route: listingId ? `/property/${listingId}` : '/simon',
    view_mode: listingId ? 'property_detail' : 'other',
    active_listing_id: listingId,
  };

  return (
    <main className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/10 px-6 lg:px-12 bg-black/60 backdrop-blur-xl">
        <Link
          href={listingId ? `/property/${listingId}` : '/'}
          className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-muted transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{listingId ? 'BACK TO RESIDENCE' : 'BACK TO SITE'}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-gold" />
          <span className="font-display text-2xl tracking-[0.16em] text-gold">
            SIMON CONCIERGE
          </span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 max-w-5xl mx-auto w-full border-x border-white/5 shadow-2xl">
        <NativeSimonChat
          pageContext={pageContext}
          activeListingTitle={title}
        />
      </div>
    </main>
  );
}
