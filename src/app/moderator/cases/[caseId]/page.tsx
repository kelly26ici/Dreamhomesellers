import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';

import { createAuthServerClient } from '@/lib/auth/supabase-server';
import {
  checkCallerIsModerator,
  fetchModerationCaseDetail,
  type ModeratorCaseDetail,
} from '@/lib/moderator/read-model';
import { fetchRevisionMedia } from '@/lib/media/read-model';
import type { ListingMediaItem } from '@/lib/media/types';
import { DecisionActionBar } from '@/components/moderator/decision-action-bar';
import { formatListingPrice } from '@/lib/marketplace/format-money';

export const metadata = {
  title: 'Case Review — LUXONN Staff',
  description: 'Inspect listing submission facts, automated pre-checks, and decide publication.',
};

interface CaseReviewPageProps {
  readonly params: Promise<{ caseId: string }>;
}

export default function CaseReviewPage({ params }: CaseReviewPageProps) {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background px-4 py-16 lg:px-12">
      <Link
        href="/moderator"
        className="absolute left-6 top-6 z-10 flex items-center gap-2 text-sm tracking-[0.2em] text-muted transition-colors hover:text-gold lg:left-12"
      >
        ← MODERATION QUEUE
      </Link>

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <p className="text-xs tracking-[0.3em] text-gold">LUXONN STAFF WORKSPACE</p>
        <Suspense fallback={<CaseSkeleton />}>
          <CaseReviewLoader params={params} />
        </Suspense>
      </div>
    </main>
  );
}

function CaseSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading case" className="mt-8 space-y-4">
      <div className="h-12 w-1/2 animate-pulse rounded-lg border border-gold/10 bg-surface-2/40" />
      <div className="h-64 w-full animate-pulse rounded-xl border border-gold/10 bg-surface-2/40" />
    </div>
  );
}

async function CaseReviewLoader({ params }: CaseReviewPageProps) {
  await connection();
  const { caseId } = await params;

  const client = await createAuthServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return (
      <div className="mt-10 rounded-2xl border border-gold/15 bg-surface-1/80 p-8">
        <h2 className="text-2xl font-heading text-foreground">Staff sign in required</h2>
        <p className="mt-2 text-sm text-muted">Sign in to review moderation cases.</p>
        <div className="mt-6">
          <Link
            href={`/login?next=%2Fmoderator%2Fcases%2F${encodeURIComponent(caseId)}`}
            className="inline-block rounded-lg border border-gold/40 bg-gold/10 px-6 py-2.5 text-sm tracking-wide text-gold hover:bg-gold/20"
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
      <div className="mt-10 rounded-2xl border border-red-500/20 bg-surface-1/80 p-8">
        <h2 className="text-2xl font-heading text-foreground">Staff Authorization Required</h2>
        <p className="mt-2 text-sm text-muted">
          Your account does not hold platform moderator privileges.
        </p>
      </div>
    );
  }

  const result = await fetchModerationCaseDetail(caseId);
  if (!result.ok) {
    return (
      <div className="mt-10 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <p className="text-sm text-red-300">{result.message}</p>
      </div>
    );
  }

  let media: ListingMediaItem[] = [];
  if (result.detail.revision?.revisionId) {
    const mediaRes = await fetchRevisionMedia(result.detail.revision.revisionId);
    if (mediaRes.ok) {
      media = [...mediaRes.data];
    }
  }

  return <CaseReviewView detail={result.detail} media={media} />;
}

function CaseReviewView({
  detail,
  media,
}: {
  readonly detail: ModeratorCaseDetail;
  readonly media: ListingMediaItem[];
}) {
  const { case: c, organization: o, listing: l, revision: r, preChecks, decisionHistory } = detail;
  const isCaseOpen = c.caseState === 'open';

  return (
    <div className="mt-8 space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-champagne">
              {c.reference ?? c.caseId}
            </span>
            <span
              className={
                isCaseOpen
                  ? 'rounded-full border border-gold/30 bg-gold/10 px-3 py-0.5 text-xs tracking-wider text-gold uppercase'
                  : 'rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-xs tracking-wider text-muted uppercase'
              }
            >
              {c.caseState}
            </span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] tracking-wider text-muted uppercase">
              {c.caseKind}
            </span>
          </div>
          <h1 className="mt-2 font-heading text-3xl text-foreground">
            {r?.title ?? 'Listing Case'}
          </h1>
          <p className="mt-1 text-xs text-muted">
            Submitted by <span className="text-champagne">{o.displayName}</span> · Opened {new Date(c.openedAt).toLocaleString()}
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs text-muted">Listing Lifecycle</p>
          <p className="font-mono text-sm tracking-wider text-gold">{l.lifecycleState.toUpperCase()}</p>
          {r && (
            <p className="text-[11px] text-muted">Revision State: <span className="text-foreground">{r.revisionState}</span></p>
          )}
        </div>
      </header>

      {/* Main Grid: Content vs Decision / Checks */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Revision Facts */}
        <div className="space-y-6 lg:col-span-2">
          {r ? (
            <div className="space-y-6 rounded-2xl border border-gold/15 bg-surface-2/20 p-6 backdrop-blur-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-4">
                <div>
                  <p className="text-[10px] tracking-widest text-gold uppercase">OFFER PRICE</p>
                  <p className="font-heading text-2xl text-foreground">
                    {formatListingPrice(r.priceAmount, r.priceCurrency, r.pricePeriod)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-widest text-gold uppercase">LOCATION</p>
                  <p className="text-sm text-foreground">
                    {[r.area, r.city, r.county, r.country].filter(Boolean).join(', ')}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-xs tracking-widest text-gold uppercase">DESCRIPTION</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                  {r.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] text-muted uppercase">BEDROOMS</p>
                  <p className="text-sm font-semibold text-foreground">{r.bedrooms ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase">BATHROOMS</p>
                  <p className="text-sm font-semibold text-foreground">{r.bathrooms ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase">AREA (M²)</p>
                  <p className="text-sm font-semibold text-foreground">{r.squareMeters ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase">LOT SIZE</p>
                  <p className="text-sm font-semibold text-foreground">{r.lotSizeSqm ? `${r.lotSizeSqm} m²` : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase">PROPERTY TYPE</p>
                  <p className="text-sm font-semibold text-foreground">{r.propertyType}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase">YEAR BUILT</p>
                  <p className="text-sm font-semibold text-foreground">{r.yearBuilt ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase">FLOORS</p>
                  <p className="text-sm font-semibold text-foreground">
                    {r.floorNumber !== null && r.totalFloors !== null ? `${r.floorNumber} of ${r.totalFloors}` : (r.floorNumber ?? r.totalFloors ?? '—')}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase">FURNISHED</p>
                  <p className="text-sm font-semibold text-foreground">{r.furnished ? 'Yes' : 'No'}</p>
                </div>
              </div>

              {r.amenities.length > 0 && (
                <div className="border-t border-white/10 pt-4">
                  <p className="text-[10px] tracking-widest text-gold uppercase">AMENITIES</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.amenities.map((a) => (
                      <span key={a} className="rounded-full border border-gold/20 bg-gold/5 px-3 py-1 text-xs text-foreground">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-surface-2/20 p-8 text-center text-sm text-muted">
              No revision snapshot attached to this case.
            </div>
          )}

          {/* Media Assets Section */}
          <div className="rounded-2xl border border-gold/15 bg-surface-2/20 p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] tracking-widest text-gold uppercase">RESIDENCE VISUAL DOSSIER</p>
                <h3 className="mt-1 font-heading text-lg tracking-wide text-foreground">
                  Attached Media ({media.length})
                </h3>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-muted">
                Private Ingestion Lane
              </span>
            </div>

            {media.length === 0 ? (
              <p className="mt-4 text-xs text-muted">
                No visual assets attached to this revision. (Pre-check warning: media_present).
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((item, idx) => (
                  <div
                    key={item.mediaId}
                    className={`relative overflow-hidden rounded-xl border p-3 ${
                      item.isFeatured
                        ? 'border-gold/60 bg-gold/10'
                        : 'border-white/10 bg-surface-1/40'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-muted">
                      <span>#{idx + 1}</span>
                      <span className="uppercase">{item.kind}</span>
                    </div>
                    <div className="mt-2 text-center text-xs font-mono text-champagne truncate">
                      {item.mediaId.slice(0, 8)}...
                    </div>
                    {item.isFeatured && (
                      <span className="mt-2 block rounded bg-gold/20 text-center text-[9px] font-bold text-gold">
                        COVER HERO
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Pre-Checks & Decision Bar */}
        <div className="space-y-6">
          {/* Action Bar */}
          <DecisionActionBar
            caseId={c.caseId}
            revisionId={r?.revisionId}
            isCaseOpen={isCaseOpen}
          />

          {/* Pre-Checks Card */}
          <div className="rounded-2xl border border-gold/15 bg-surface-2/20 p-6 backdrop-blur-sm">
            <h3 className="font-heading text-lg tracking-wide text-foreground">
              Automated Pre-Checks
            </h3>
            <p className="mt-1 text-xs text-muted">
              Deterministic sanity checks run at submission time (ADR-013).
            </p>

            <ul className="mt-4 space-y-3">
              {preChecks.map((pc) => (
                <li key={pc.checkId} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs">
                  <div>
                    <span className="font-medium text-foreground">{pc.checkCode}</span>
                    {pc.detailCode && (
                      <span className="ml-2 text-[10px] text-muted font-mono">{pc.detailCode}</span>
                    )}
                  </div>
                  <span
                    className={
                      pc.outcome === 'pass'
                        ? 'rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300'
                        : pc.outcome === 'warn'
                          ? 'rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300'
                          : 'rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300'
                    }
                  >
                    {pc.outcome.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Prior Decisions */}
          {decisionHistory.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-surface-2/20 p-6">
              <h3 className="font-heading text-base tracking-wide text-foreground">
                Decision History
              </h3>
              <ul className="mt-3 space-y-3">
                {decisionHistory.map((dh) => (
                  <li key={dh.decisionId} className="rounded-lg border border-white/5 bg-black/30 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-champagne uppercase">{dh.decision}</span>
                      <span className="text-[10px] text-muted">{new Date(dh.decidedAt).toLocaleDateString()}</span>
                    </div>
                    {dh.note && (
                      <p className="mt-1 text-muted italic">&ldquo;{dh.note}&rdquo;</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted">Reason: {dh.reasonCode}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
