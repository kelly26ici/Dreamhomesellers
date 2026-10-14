/**
 * /owner/listings/[listingId] — listing detail + lifecycle actions.
 *
 * Resolution chain: org ids → RLS-governed PostgREST select for the
 * listing's latest revision id → owner_listing_revision (migration 0004)
 * for the full projection. The RLS policy revision_org_read scopes the
 * select to the caller's orgs, so a listing id from another owner's org
 * yields zero rows — the URL id is never an authority signal.
 *
 * Lifecycle actions render per state:
 *   draft      → Submit for review / Edit draft
 *   published  → Withdraw
 *   submitted  → status only (moderation owns those transitions)
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';

import {
  fetchOwnerOrganizations,
  fetchOwnerRevision,
  type OwnerRevisionDetail,
} from '@/lib/owner/read-model';
import { createAuthServerClient } from '@/lib/auth/supabase-server';
import { SubmitForReviewButton } from '@/components/owner/submit-for-review-button';
import { WithdrawButton } from '@/components/owner/withdraw-button';

export const metadata = {
  title: 'Listing — LUXONN Owner Portal',
  description: 'Listing revision status and lifecycle actions.',
};

interface ListingDetailPageProps {
  readonly params: Promise<{ listingId: string }>;
}

export default function ListingDetailPage({ params }: ListingDetailPageProps) {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background px-4 py-16 lg:px-12">
      <Link
        href="/owner"
        className="absolute left-6 top-6 z-10 flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold lg:left-12"
      >
        ← Owner Portal
      </Link>

      <div className="relative z-10 mx-auto w-full max-w-3xl">
        <p className="text-xs tracking-[0.3em] text-gold">LUXONN PRIVATE CLIENT</p>

        <Suspense fallback={<DetailSkeleton />}>
          <ListingDetail params={params} />
        </Suspense>
      </div>
    </main>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the listing" className="mt-10 space-y-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 w-full animate-pulse rounded-lg border border-gold/10 bg-surface-2/40"
        />
      ))}
    </div>
  );
}

async function ListingDetail({ params }: ListingDetailPageProps) {
  // cacheComponents: mark this boundary dynamic before auth work.
  await connection();
  const { listingId } = await params;

  const client = await createAuthServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return (
      <div className="mt-10 rounded-2xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 backdrop-blur-md">
        <h2 className="text-2xl font-heading text-foreground">
          Owner sign in required
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          Sign in to your LUXONN account to view and manage this listing.
        </p>
        <div className="mt-6">
          <Link
            href={`/login?next=%2Fowner%2Flistings%2F${encodeURIComponent(listingId)}`}
            className="inline-block rounded-lg border border-gold/40 bg-gold/10 px-6 py-2.5 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20"
          >
            Sign in to continue
          </Link>
        </div>
      </div>
    );
  }

  const orgs = await fetchOwnerOrganizations();
  if ('ok' in orgs) {
    return <DetailError message={orgs.message} />;
  }
  if (orgs.length === 0) {
    return (
      <DetailError message="Your account has no organization yet. Return to the portal to create one." />
    );
  }

  // Latest revision of this listing, scoped to the caller's orgs by RLS.
  // Zero rows = not your listing (or it genuinely has no revision).
  const { data: revisionRows, error } = await client
    .from('listing_revisions')
    .select('revision_id, revision_state, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error !== null) {
    return <DetailError message={error.message} />;
  }
  const latest = revisionRows?.[0];
  if (!latest) {
    return (
      <DetailError message="This listing was not found in your organization. It may belong to another owner." />
    );
  }

  const detail = await fetchOwnerRevision(latest.revision_id);
  if (!detail.ok) {
    return <DetailError message={detail.message} />;
  }

  return <DetailView detail={detail.detail} />;
}

function DetailError({ message }: { message: string }) {
  return (
    <div className="mt-10 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
      <p className="text-sm text-red-300">{message}</p>
      <p className="mt-2 text-xs text-muted">
        <Link href="/owner" className="text-gold underline">
          Back to the portal
        </Link>
      </p>
    </div>
  );
}

function DetailView({ detail }: { detail: OwnerRevisionDetail }) {
  const isDraft = detail.revisionState === 'draft';
  const isPublished = detail.lifecycleState === 'published';

  return (
    <div className="mt-10 space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-heading tracking-wide text-foreground">
          {detail.title}
        </h1>
        <span
          className={
            isPublished
              ? 'rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs tracking-wide text-emerald-300'
              : isDraft
                ? 'rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs tracking-wide text-gold'
                : 'rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-wide text-muted'
          }
        >
          {detail.revisionState}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-2xl border border-gold/10 bg-surface-2/30 p-6 sm:grid-cols-2">
        <Fact label="Kind" value={detail.listingKind} />
        <Fact label="Type" value={detail.propertyType} />
        <Fact
          label="Price"
          value={`${detail.price.amount} ${detail.price.currency} · ${detail.pricePeriod}`}
        />
        <Fact
          label="Location"
          value={
            [detail.area, detail.city, detail.town, detail.county]
              .filter(Boolean)
              .join(', ') || null
          }
        />
        <Fact label="Bedrooms" value={detail.bedrooms} />
        <Fact label="Bathrooms" value={detail.bathrooms} />
        <Fact
          label="Floor area"
          value={detail.squareMeters !== null ? `${detail.squareMeters} m²` : null}
        />
        <Fact
          label="Lot size"
          value={detail.lotSizeSqm !== null ? `${detail.lotSizeSqm} m²` : null}
        />
        <Fact label="Year built" value={detail.yearBuilt} />
        <Fact label="Furnished" value={detail.furnished ? 'Yes' : 'No'} />
        {detail.amenities.length > 0 && (
          <Fact label="Amenities" value={detail.amenities.join(', ')} />
        )}
        <Fact
          label="Last updated"
          value={new Date(detail.updatedAt).toLocaleDateString('en-KE', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        />
      </dl>

      <section>
        <h2 className="text-sm tracking-[0.2em] text-gold">DESCRIPTION</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">
          {detail.description}
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-gold/10 pt-6">
        {isDraft && <SubmitForReviewButton revisionId={detail.revisionId} />}
        {isDraft && (
          <Link
            href={`/owner/listings/${detail.listingId}/edit`}
            className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20"
          >
            Edit draft
          </Link>
        )}
        {isPublished && <WithdrawButton listingId={detail.listingId} />}
        {detail.revisionState === 'submitted' && (
          <p className="text-xs text-muted">
            Under review by LUXONN moderation. You will see the outcome here.
          </p>
        )}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs tracking-[0.2em] text-muted">{label.toUpperCase()}</dt>
      <dd className="mt-1 text-sm text-foreground">
        {value === null || value === undefined || value === ''
          ? '—'
          : String(value)}
      </dd>
    </div>
  );
}
