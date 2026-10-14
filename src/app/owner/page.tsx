/**
 * /owner — the owner portal shell.
 *
 * Phase 2 build: bootstrap gate + listings overview. The static shell
 * prerenders (branding + skeleton); the session-dependent work streams
 * inside Suspense because it reads the auth cookie, which cacheComponents
 * forbids in the static shell. The consent page established the pattern:
 * `await connection()` BEFORE any auth call so auth-js's internal
 * Date.now() check doesn't trip the blocking-prerender error during
 * prerender.
 *
 * Gate sequence (all server-side, no client session probing):
 *   1. signed in?          no → surface sign-in link (the inner component
 *      renders inside the shell, so we render the sign-in CTA rather than
 *      redirect from inside Suspense).
 *   2. has organizations?  no → render onboarding (create solo org).
 *   3. multiple?           yes → Phase 2 resolves to the first org.
 *   4. render the listings overview for the resolved org.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';

import {
  fetchOwnerOrganizations,
  fetchOwnerListings,
  type OwnerListingSummary,
} from '@/lib/owner/read-model';
import { OwnerOnboardingForm } from '@/components/owner/onboarding-form';

export const metadata = {
  title: 'Owner Portal — LUXONN',
  description:
    'Manage your LUXONN listings: drafts, moderation status, and published residences.',
};

export default function OwnerPortalPage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background px-4 py-16 lg:px-12">
      <Link
        href="/"
        className="absolute left-6 top-6 z-10 flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold lg:left-12"
      >
        ← LUXONN
      </Link>

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <p className="text-xs tracking-[0.3em] text-gold">LUXONN PRIVATE CLIENT</p>
        <h1 className="mt-2 text-4xl font-heading tracking-wide text-foreground">
          Owner Portal
        </h1>

        <Suspense fallback={<PortalSkeleton />}>
          <Portal />
        </Suspense>
      </div>
    </main>
  );
}

function PortalSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading your listings"
      className="mt-10 space-y-4"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 w-full animate-pulse rounded-xl border border-gold/10 bg-surface-2/40"
        />
      ))}
    </div>
  );
}

async function Portal() {
  // cacheComponents: mark this boundary dynamic before any auth call.
  await connection();

  const orgs = await fetchOwnerOrganizations();
  // Discriminant narrowing (not Array.isArray — its predicate is `any[]`
  // and leaves readonly string[] behind, so .message would not resolve).
  // OwnerRpcError is the only union member carrying `ok`.
  if ('ok' in orgs) {
    return <PortalError message={orgs.message} />;
  }

  if (orgs.length === 0) {
    return <Onboarding />;
  }

  // Phase 2 scope: resolve to the first org. Multi-org pickers arrive with
  // brokerage support.
  const organizationId = orgs[0];

  const listings = await fetchOwnerListings(organizationId);
  if (!listings.ok) {
    return <PortalError message={listings.message} />;
  }

  return (
    <ListingsOverview organizationId={organizationId} items={listings.items} />
  );
}

function PortalError({ message }: { message: string }) {
  return (
    <div className="mt-10 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
      <p className="text-sm text-red-300">
        Something went wrong loading your portal. {message}
      </p>
      <p className="mt-2 text-xs text-muted">
        If you are not signed in,{' '}
        <Link href="/login?next=%2Fowner" className="text-gold underline">
          sign in
        </Link>{' '}
        and try again.
      </p>
    </div>
  );
}

function Onboarding() {
  return (
    <div className="mt-10 rounded-2xl border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 backdrop-blur-md">
      <h2 className="text-2xl font-heading text-foreground">
        Create your organization
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted">
        LUXONN listings belong to organizations. A private client account
        starts with a solo organization — your name as it should appear on
        LUXONN.
      </p>
      <OwnerOnboardingForm />
    </div>
  );
}

function ListingsOverview({
  organizationId,
  items,
}: {
  organizationId: string;
  items: readonly OwnerListingSummary[];
}) {
  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {items.length === 0
            ? 'No listings yet.'
            : `${items.length} listing${items.length === 1 ? '' : 's'}`}
        </p>
        <Link
          href={`/owner/listings/new?org=${encodeURIComponent(organizationId)}`}
          className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20"
        >
          + New listing
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-gold/10 bg-surface-2/30 p-10 text-center">
          <p className="text-sm text-muted">
            Your first draft is one form away. Listings go through moderation
            before they appear on the public site.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <ListingRow key={item.listingId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListingRow({ item }: { item: OwnerListingSummary }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gold/10 bg-surface-2/30 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {item.published.title ?? item.listingId}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {[
            item.listingKind,
            item.published.city ?? item.published.area,
            item.published.county,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <span
        className={
          item.lifecycleState === 'published'
            ? 'rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs tracking-wide text-emerald-300'
            : item.lifecycleState === 'withdrawn' || item.lifecycleState === 'closed'
              ? 'rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-wide text-muted'
              : 'rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs tracking-wide text-gold'
        }
      >
        {item.lifecycleState}
      </span>
    </li>
  );
}
