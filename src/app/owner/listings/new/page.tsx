/**
 * /owner/listings/new — create a listing draft.
 *
 * The org id is resolved server-side from `current_user_org_ids()` via
 * fetchOwnerOrganizations(), the same source /owner uses. It is never read
 * from the URL or any user input: create_listing_draft re-checks membership
 * server-side anyway, but the read model's discipline is that the portal
 * only ever passes an org the session actually belongs to.
 *
 * cacheComponents: auth reads the request cookie, so the loader sits inside
 * the Suspense boundary after `await connection()` — the same discipline the
 * /owner shell uses.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';

import { createAuthServerClient } from '@/lib/auth/supabase-server';
import { fetchOwnerOrganizations } from '@/lib/owner/read-model';
import { ListingDraftForm } from '@/components/owner/listing-draft-form';

export const metadata = {
  title: 'New Listing — LUXONN Owner Portal',
  description: 'Create a listing draft for moderation review.',
};

export default function NewListingPage() {
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
        <h1 className="mt-2 text-4xl font-heading tracking-wide text-foreground">
          New Listing
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted">
          Draft the residence facts here. Everything saves as a draft revision
          — nothing appears on the public site until it passes moderation.
        </p>

        <Suspense fallback={<FormSkeleton />}>
          <NewListingLoader />
        </Suspense>
      </div>
    </main>
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the listing form" className="mt-10 space-y-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-12 w-full animate-pulse rounded-lg border border-gold/10 bg-surface-2/40"
        />
      ))}
    </div>
  );
}

async function NewListingLoader() {
  // cacheComponents: mark this boundary dynamic before any auth call.
  await connection();

  const client = await createAuthServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return (
      <div className="mt-10 rounded-lg border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 backdrop-blur-md">
        <h2 className="text-2xl font-heading text-foreground">
          Owner sign in required
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          Sign in to your LUXONN account to create a listing draft.
        </p>
        <div className="mt-6">
          <Link
            href="/login?next=%2Fowner%2Flistings%2Fnew"
            className="inline-block rounded-md border border-gold/40 bg-gold/10 px-6 py-2.5 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20"
          >
            Sign in to continue
          </Link>
        </div>
      </div>
    );
  }

  const orgs = await fetchOwnerOrganizations();
  if ('ok' in orgs) {
    return (
      <div className="mt-10 rounded-lg border border-red-500/30 bg-red-500/5 p-6">
        <p className="text-sm text-red-300">
          Something went wrong loading your organizations. {orgs.message}
        </p>
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="mt-10 rounded-lg border border-gold/15 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 backdrop-blur-md">
        <h2 className="text-2xl font-heading text-foreground">
          Create your organization first
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          LUXONN listings belong to organizations. Create your solo
          organization in the owner portal, then come back to draft a listing.
        </p>
        <div className="mt-6">
          <Link
            href="/owner"
            className="inline-block rounded-md border border-gold/40 bg-gold/10 px-6 py-2.5 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20"
          >
            Go to the owner portal
          </Link>
        </div>
      </div>
    );
  }

  // Phase 2 scope: resolve to the first org, matching /owner. Multi-org
  // pickers arrive with brokerage support.
  const organizationId = orgs[0];

  return <ListingDraftForm mode={{ kind: 'create', organizationId }} />;
}
