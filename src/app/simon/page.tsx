import type { Metadata } from 'next';
import { connection } from 'next/server';
import { SimonAssistantChat } from '@/components/simon/SimonAssistantChat';
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
    <main data-simon-full-page className="h-dvh overflow-hidden bg-[#050505]">
      <SimonAssistantChat
        pageContext={pageContext}
        activeListingTitle={title}
      />
    </main>
  );
}
