import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';

import { createAuthServerClient } from '@/lib/auth/supabase-server';
import {
  checkCallerIsModerator,
  fetchModerationCases,
  type ModeratorCaseSummary,
} from '@/lib/moderator/read-model';
import { BootstrapAdminButton } from '@/components/moderator/bootstrap-admin-button';

export const metadata = {
  title: 'Staff Moderation Queue — LUXONN',
  description: 'Review submitted listing revisions and enforce marketplace standards.',
};

export default function ModeratorQueuePage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background px-4 py-16 lg:px-12">
      <Link
        href="/"
        className="absolute left-6 top-6 z-10 flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold lg:left-12"
      >
        ← LUXONN
      </Link>

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <p className="text-xs tracking-[0.3em] text-gold">LUXONN STAFF WORKSPACE</p>
        <h1 className="mt-2 text-4xl font-heading tracking-wide text-foreground">
          Moderation Queue
        </h1>
        <p className="mt-2 text-sm text-muted">
          Review owner submissions, inspect automated pre-checks, and decide publication.
        </p>

        <Suspense fallback={<QueueSkeleton />}>
          <ModeratorQueue />
        </Suspense>
      </div>
    </main>
  );
}

function QueueSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading queue" className="mt-10 space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 w-full animate-pulse rounded-lg border border-gold/10 bg-surface-2/40"
        />
      ))}
    </div>
  );
}

async function ModeratorQueue() {
  await connection();

  const client = await createAuthServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return (
      <div className="mt-10 rounded-lg border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 backdrop-blur-md">
        <h2 className="text-2xl font-heading text-foreground">Staff sign in required</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          Sign in with your staff account to access the listing moderation queue.
        </p>
        <div className="mt-6">
          <Link
            href="/login?next=%2Fmoderator"
            className="inline-block rounded-md border border-gold/40 bg-gold/10 px-6 py-2.5 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20"
          >
            Sign in to continue
          </Link>
        </div>
      </div>
    );
  }

  const isModerator = await checkCallerIsModerator();
  if (!isModerator) {
    return (
      <div className="mt-10 rounded-lg border border-red-500/20 bg-surface-1/80 p-8 backdrop-blur-md">
        <h2 className="text-2xl font-heading text-foreground">Staff Authorization Required</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          Your account is signed in but does not hold a platform moderator or admin role.
        </p>
        <p className="mt-4 text-xs text-champagne">
          If you are the platform founder initializing a fresh environment:
        </p>
        <BootstrapAdminButton />
      </div>
    );
  }

  const cases = await fetchModerationCases('open');
  if (!cases.ok) {
    return (
      <div className="mt-10 rounded-lg border border-red-500/30 bg-red-500/5 p-6">
        <p className="text-sm text-red-300">{cases.message}</p>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {cases.items.length === 0
            ? 'No open cases in the review queue.'
            : `${cases.items.length} open case${cases.items.length === 1 ? '' : 's'}`}
        </p>
        <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs tracking-wider text-gold">
          ACTIVE QUEUE
        </span>
      </div>

      {cases.items.length === 0 ? (
        <div className="mt-6 rounded-lg border border-gold/10 bg-surface-2/30 p-12 text-center">
          <p className="text-sm text-muted">
            All submitted listings have been reviewed. New owner submissions will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {cases.items.map((item) => (
            <CaseCard key={item.caseId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CaseCard({ item }: { readonly item: ModeratorCaseSummary }) {
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-gold/15 bg-surface-2/30 p-6 transition-colors hover:border-gold/30 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-champagne">
            {item.reference ?? item.caseId.slice(0, 8)}
          </span>
          <span className="rounded border border-gold/30 bg-gold/5 px-2 py-0.5 text-[10px] tracking-wider text-gold uppercase">
            {item.caseKind}
          </span>
          <span className="text-xs text-muted">
            Org: {item.organizationName}
          </span>
        </div>

        <h3 className="mt-2 truncate font-heading text-xl text-foreground">
          {item.revisionTitle ?? 'Untitled Revision'}
        </h3>

        <p className="mt-1 text-xs text-muted">
          {[
            item.listingKind,
            item.area,
            item.city,
            item.priceAmount ? `${item.priceCurrency ?? 'KES'} ${Number(item.priceAmount).toLocaleString()}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {item.preChecks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.preChecks.map((pc) => (
              <span
                key={pc.checkCode}
                className={
                  pc.outcome === 'pass'
                    ? 'rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300'
                    : pc.outcome === 'warn'
                      ? 'rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300'
                      : 'rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300'
                }
              >
                {pc.checkCode}: {pc.outcome}
              </span>
            ))}
          </div>
        )}
      </div>

      <Link
        href={`/moderator/cases/${item.caseId}`}
        className="self-start rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold tracking-wider text-gold transition-colors hover:bg-gold/20 sm:self-center"
      >
        REVIEW CASE →
      </Link>
    </li>
  );
}
