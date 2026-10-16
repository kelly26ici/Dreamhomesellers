/**
 * /owner/listings/[listingId]/edit — edit a draft revision's content.
 *
 * The same resolution chain as the detail page: org ids → RLS-governed
 * PostgREST select for the listing's latest revision → owner_listing_revision
 * (migration 0004) for the full projection. Two gates before the form:
 *
 *   1. Zero revision rows → "not your listing" (revision_org_read scopes
 *      the select to the caller's orgs; the URL id is never an authority).
 *   2. The latest revision is NOT a draft → redirect to the detail page,
 *      which renders the state-appropriate actions. Editing is only legal
 *      while revision_state = 'draft'; update_draft_revision re-checks
 *      this server-side, and the redirect keeps the URL honest.
 *
 * Prefill flows through the form's `initial` prop (which maps via
 * revisionDetailToFormState), so every rendered field is also a mapped
 * field — an edit-save cannot silently null anything.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import {
  fetchOwnerOrganizations,
  fetchOwnerRevision,
} from '@/lib/owner/read-model';
import { createAuthServerClient } from '@/lib/auth/supabase-server';
import { ListingDraftForm } from '@/components/owner/listing-draft-form';

export const metadata = {
  title: 'Edit Draft — LUXONN Owner Portal',
  description: 'Edit a listing draft before submitting it for review.',
};

interface EditDraftPageProps {
  readonly params: Promise<{ listingId: string }>;
}

export default function EditDraftPage({ params }: EditDraftPageProps) {
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
          Edit Draft
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted">
          Update the residence facts. Changes stay in the draft until you
          submit it for moderation.
        </p>

        <Suspense fallback={<EditSkeleton />}>
          <EditLoader params={params} />
        </Suspense>
      </div>
    </main>
  );
}

function EditSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the draft"
      className="mt-10 space-y-4"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-12 w-full animate-pulse rounded-lg border border-gold/10 bg-surface-2/40"
        />
      ))}
    </div>
  );
}

async function EditLoader({ params }: EditDraftPageProps) {
  // cacheComponents: mark this boundary dynamic before auth work.
  await connection();
  const { listingId } = await params;

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
          Sign in to your LUXONN account to edit this draft.
        </p>
        <div className="mt-6">
          <Link
            href={`/login?next=%2Fowner%2Flistings%2F${encodeURIComponent(listingId)}%2Fedit`}
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
    return <EditError message={orgs.message} />;
  }
  if (orgs.length === 0) {
    return (
      <EditError message="Your account has no organization yet. Return to the portal to create one." />
    );
  }

  // Latest revision, scoped to the caller's orgs by RLS. Zero rows =
  // not your listing (or it has no revision at all) — same message either
  // way, so the URL cannot be probed to distinguish them.
  const { data: revisionRows, error } = await client
    .from('listing_revisions')
    .select('revision_id, revision_state, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error !== null) {
    return <EditError message={error.message} />;
  }
  const latest = revisionRows?.[0];
  if (!latest) {
    return (
      <EditError message="This listing was not found in your organization. It may belong to another owner." />
    );
  }

  // Draft-only surface: a submitted/published revision redirects to the
  // detail page, which renders the state-appropriate actions.
  if (latest.revision_state !== 'draft') {
    redirect(`/owner/listings/${listingId}`);
  }

  const detail = await fetchOwnerRevision(latest.revision_id);
  if (!detail.ok) {
    return <EditError message={detail.message} />;
  }

  return (
    <ListingDraftForm
      mode={{
        kind: 'edit',
        revisionId: detail.detail.revisionId,
        listingId: detail.detail.listingId,
      }}
      initial={detail.detail}
    />
  );
}

function EditError({ message }: { message: string }) {
  return (
    <div className="mt-10 rounded-lg border border-red-500/30 bg-red-500/5 p-6">
      <p className="text-sm text-red-300">{message}</p>
      <p className="mt-2 text-xs text-muted">
        <Link href="/owner" className="text-gold underline">
          Back to the portal
        </Link>
      </p>
    </div>
  );
}
